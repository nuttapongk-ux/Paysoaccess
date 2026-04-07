import { db, auth } from './firebase-config.js';
import { collection, doc, getDoc, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// DOM Elements
const form = document.getElementById('accessRequestForm');
const storeId = document.getElementById('storeId');
const storeName = document.getElementById('storeName');
const currentUserIndexEl = document.getElementById('currentUserIndex');
const usernameInput = document.getElementById('usernameInput');
const emailInput = document.getElementById('emailInput');
const roleInputs = document.getElementsByName('roleInput');
const permInputs = document.getElementsByName('permissions');

const togglePermissionsBtn = document.getElementById('togglePermissions');
const permissionsWrapper = document.getElementById('permissionsWrapper');
const chevronIcon = document.getElementById('chevronIcon');

const queuedUsersList = document.getElementById('queuedUsersList');
const queueCount = document.getElementById('queueCount');
const clearBtn = document.getElementById('clearBtn');
const submitAllBtn = document.getElementById('submitAllBtn');
const submitLoader = document.getElementById('submitLoader');
const statusMessage = document.getElementById('statusMessage');

const requestsCollection = collection(db, 'access_requests');

// Menu Configuration State
let dynamicMenuHtml = '<div class="loading-state">Loading menus...</div>';

// Fetch Menu from Firebase
const fetchMenuConfig = async () => {
    try {
        const docRef = doc(db, 'system_settings', 'menu_configuration');
        const docSnap = await getDoc(docRef);
        
        let categories = [];
        if (docSnap.exists()) {
            categories = docSnap.data().categories;
        } else {
            // Fallback default
            categories = [
                { title: "", items: [{name: "แดชบอร์ด", isLocked: true}, {name:"ยอดรวมรายได้", isLocked:false}] }
            ];
        }

        // Migrate string arrays to object if necessary directly inside render loop
        dynamicMenuHtml = `
            <div class="permissions-actions" style="display:flex; justify-content:flex-end; align-items:center; gap:0.5rem; margin-bottom: 1rem; margin-top: -0.5rem;">
                <button type="button" class="btn-select-all" style="color:#2563eb; background:#eff6ff; border:none; cursor:pointer; font-size:0.75rem; font-weight:500; padding: 0.35rem 0.75rem; border-radius: 4px; font-family:'Inter', sans-serif; align-self: flex-start; line-height: 1.2;">เลือกทั้งหมด</button>
                <button type="button" class="btn-clear-all" style="color:#475569; background:#ffffff; border: 1px solid #e2e8f0; cursor:pointer; font-size:0.75rem; font-weight:500; padding: 0.35rem 0.75rem; border-radius: 4px; font-family:'Inter', sans-serif; align-self: flex-start; line-height: 1.2;">ล้าง</button>
            </div>
            <div class="permissions-tree">
        `;

        dynamicMenuHtml += categories.map((cat, catIdx) => {
            const hasTitle = cat.title && cat.title.trim() !== '';
            
            // Build items
            const itemsHtml = cat.items.map(item => {
                const iObj = typeof item === 'string' ? { name: item, isLocked: false } : item;
                const lockedHtml = iObj.isLocked ? `checked disabled` : ``;
                const iconHtml = iObj.isLocked ? ` <span style="color:#10b981; font-size:0.75rem;">🛡️</span>` : ``;
                return `
                    <label class="checkbox-container ${hasTitle ? 'child-item' : 'standalone-item'}">
                        <input type="checkbox" name="permissions" class="${hasTitle ? 'child-checkbox' : 'standalone-checkbox'}" value="${sanitize(iObj.name)}" ${lockedHtml}> 
                        <span class="checkmark 
                        ${iObj.isLocked ? 'locked-checkmark' : ''}"></span>${sanitize(iObj.name)}${iconHtml}
                    </label>
                `;
            }).join('');

            if (hasTitle) {
                const lockedParentHtml = cat.isTitleLocked ? `checked disabled` : ``;
                const pIconHtml = cat.isTitleLocked ? ` <span style="color:#10b981; font-size:0.75rem;">🛡️</span>` : ``;
                return `
                    <div class="permissions-group nested-group" style="margin-bottom: 1rem; border: 1px solid #f1f5f9; border-radius: 8px; padding: 1rem;">
                        <label class="checkbox-container parent-item" style="font-weight: 600; font-size: 0.95rem; color: #1e293b; margin-bottom: 0.5rem;">
                            <input type="checkbox" name="permissions" class="parent-checkbox" value="${sanitize(cat.title)}" ${lockedParentHtml}>
                            <span class="checkmark ${cat.isTitleLocked ? 'locked-checkmark' : ''}"></span>${sanitize(cat.title)}${pIconHtml}
                        </label>
                        <div class="permissions-children" style="margin-left: 2rem;">
                            ${itemsHtml}
                        </div>
                    </div>
                `;
            } else {
                return `<div class="permissions-group flat-group" style="margin-bottom:0.5rem;">${itemsHtml}</div>`;
            }
        }).join('');

        dynamicMenuHtml += `</div>`;

    } catch (e) {
        console.error('Failed to load menu config', e);
        dynamicMenuHtml = '<div class="error">Failed to load permissions. Contact support.</div>';
    }
};

// Event Delegation for Permission Trees
document.addEventListener('change', (e) => {
    if(e.target.classList.contains('parent-checkbox')) {
        const parentDiv = e.target.closest('.permissions-group');
        const children = parentDiv.querySelectorAll('.child-checkbox:not(:disabled)');
        children.forEach(c => c.checked = e.target.checked);
    }
    else if(e.target.classList.contains('child-checkbox')) {
        const parentDiv = e.target.closest('.permissions-group');
        const parentCb = parentDiv.querySelector('.parent-checkbox');
        if (parentCb && !parentCb.disabled) {
            const children = parentDiv.querySelectorAll('.child-checkbox');
            const allChecked = Array.from(children).every(c => c.checked);
            const someChecked = Array.from(children).some(c => c.checked);
            
            parentCb.checked = allChecked;
            parentCb.indeterminate = someChecked && !allChecked;
        }
    }
});

document.addEventListener('click', (e) => {
    if(e.target.classList.contains('btn-select-all')) {
        const wrapper = e.target.closest('.permissions-wrapper');
        if(wrapper) wrapper.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(c => c.checked = true);
    }
    if(e.target.classList.contains('btn-clear-all')) {
        const wrapper = e.target.closest('.permissions-wrapper');
        if(wrapper) {
            wrapper.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(c => c.checked = false);
            wrapper.querySelectorAll('.parent-checkbox').forEach(c => c.indeterminate = false);
        }
    }
});

// State
let queuedUsers = [];

// Events
togglePermissionsBtn.addEventListener('click', () => {
    permissionsWrapper.classList.toggle('hidden');
    if (permissionsWrapper.classList.contains('hidden')) {
        chevronIcon.textContent = '▼';
    } else {
        chevronIcon.textContent = '▲';
    }
});

const showMessage = (msg, type = 'success') => {
    statusMessage.textContent = msg;
    statusMessage.className = `status-message ${type}`;
    setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = 'status-message';
    }, 5000);
};

const renderQueue = () => {
    queuedUsersList.innerHTML = '';
    queueCount.textContent = queuedUsers.length;
    currentUserIndexEl.textContent = queuedUsers.length + 1;
    
    submitAllBtn.disabled = queuedUsers.length === 0;

    queuedUsers.forEach((user, index) => {
        const div = document.createElement('div');
        div.className = 'queue-badge';
        div.innerHTML = `
            <div class="user-info">
                <strong>${user.username}</strong>
                <span>${user.role}</span>
            </div>
            <button type="button" class="remove-queue-btn" data-index="${index}">✕</button>
        `;
        queuedUsersList.appendChild(div);
    });

    document.querySelectorAll('.remove-queue-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const i = parseInt(e.target.getAttribute('data-index'));
            queuedUsers.splice(i, 1);
            renderQueue();
        });
    });
};

form.addEventListener('submit', (e) => {
    e.preventDefault();
    if(e.submitter && e.submitter.id === 'submitAllBtn') return; // Handled separately
    
    // Process add to queue
    const userRoleInputs = parentEntry.querySelectorAll('input[name="roleInput"]');
    let selectedRole = null;
    userRoleInputs.forEach(r => { if(r.checked) selectedRole = r.value; });

    const userPermInputs = parentEntry.querySelectorAll('input[name="permissions"]:checked');
    // For disabled checked inputs, we ALSO want to submit them. :checked covers both disabled and enabled.
    const selectedPerms = Array.from(userPermInputs).map(p => p.value);

    if(!usernameInput.value || !emailInput.value || !selectedRole) return;

    queuedUsers.push({
        username: usernameInput.value.trim(),
        email: emailInput.value.trim(),
        role: selectedRole,
        permissions: selectedPerms
    });

    // Reset User Fields only
    usernameInput.value = '';
    emailInput.value = '';
    roleInputs.forEach(r => r.checked = false);
    permInputs.forEach(p => p.checked = false);
    permissionsWrapper.classList.add('hidden');
    chevronIcon.textContent = '▼';

    renderQueue();
});

clearBtn.addEventListener('click', () => {
    queuedUsers = [];
    usernameInput.value = '';
    emailInput.value = '';
    roleInputs.forEach(r => r.checked = false);
    permInputs.forEach(p => p.checked = false);
    storeId.value = '';
    storeName.value = '';
    renderQueue();
});

submitAllBtn.addEventListener('click', async () => {
    if (queuedUsers.length === 0) return;
    
    if(!storeId.value || !storeName.value) {
        showMessage('Please provide Store ID and Store Name before submitting.', 'error');
        storeId.focus();
        return;
    }

    submitAllBtn.disabled = true;
    submitLoader.classList.remove('hidden');

    const formData = {
        storeId: storeId.value.trim(),
        storeName: storeName.value.trim(),
        users: queuedUsers,
        status: 'Pending',
        createdAt: serverTimestamp()
    };

    try {
        await addDoc(requestsCollection, formData);
        clearBtn.click(); // Reset all UI
        showMessage('All requests submitted successfully!');
    } catch (error) {
        console.error('Error adding document: ', error);
        showMessage('Failed to submit request: ' + error.message, 'error');
    } finally {
        submitLoader.classList.add('hidden');
    }
});

const sanitize = str => String(str).replace(/[&<>"']/g, match => {
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return escapeMap[match];
});

const initApp = () => {
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'login.html';
        } else {
            console.log("Logged in as:", user.email);
            // Show content and hide loading if there was a full page loader
            await fetchMenuConfig();

            const pc = document.getElementById('permissionsContainer');
            if (pc) pc.innerHTML = dynamicMenuHtml;
        }
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if(logoutBtn){
        logoutBtn.addEventListener('click', () => {
            signOut(auth);
        });
    }
};

initApp();
