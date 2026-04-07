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
                { title: "", isHeader: false, items: ["แดชบอร์ด", "ยอดรวมรายได้", "ประวัติการโอนเงินคืน"] }
            ];
        }

        // Build HTML
        dynamicMenuHtml = categories.map(cat => `
            <div class="permissions-group">
                ${cat.isHeader && cat.title ? `<h4 class="permissions-header">${sanitize(cat.title)}</h4>` : ''}
                <div class="permissions-list">
                    ${cat.items.map(item => `
                        <label class="checkbox-container"><input type="checkbox" name="permissions" value="${sanitize(item)}"> <span class="checkmark"></span>${sanitize(item)}</label>
                    `).join('')}
                </div>
            </div>
        `).join('');

    } catch (e) {
        console.error('Failed to load menu config', e);
        dynamicMenuHtml = '<div class="error">Failed to load permissions. Contact support.</div>';
    }
};

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

    const userPermInputs = parentEntry.querySelectorAll('input[name="permissions"]');
    const selectedPerms = Array.from(userPermInputs).filter(p => p.checked).map(p => p.value);

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
