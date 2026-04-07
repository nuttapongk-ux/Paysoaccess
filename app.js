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
const requestsList = document.getElementById('requestsList');

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

const formatDate = (timestamp) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate();
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
};

const renderRequests = (requests) => {
    requestsList.innerHTML = ''; 

    if (requests.length === 0) {
        requestsList.innerHTML = `<div class="empty-state">No requests found. Create one to get started!</div>`;
        return;
    }

    requests.forEach(req => {
        const card = document.createElement('div');
        card.className = 'request-card';

        const usersHtml = req.users ? req.users.map(u => `
            <div class="user-info-row" style="margin-bottom:0.75rem; padding-bottom:0.75rem; border-bottom:1px solid rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="user-info">
                        <strong>${sanitize(u.username)}</strong>
                        <span>${sanitize(u.email)}</span>
                    </div>
                    <div class="role-badge">${sanitize(u.role)}</div>
                </div>
                <div class="perms-badges" style="margin-top:0.4rem;">
                    ${u.permissions && u.permissions.length > 0 ? u.permissions.map(p => `<span class="perm-badge">${sanitize(p)}</span>`).join('') : '<span class="perm-badge empty">All Defaults</span>'}
                </div>
            </div>
            
            <div class="form-group mt-4">
                <label>บทบาท (Role)</label>
                <div class="role-grid">
                    <label class="role-option"><input type="radio" name="roleInput" value="Admin" required><span>Admin</span></label>
                    <label class="role-option"><input type="radio" name="roleInput" value="IT"><span>IT</span></label>
                    <label class="role-option"><input type="radio" name="roleInput" value="All Role"><span>All Role</span></label>
                    <label class="role-option"><input type="radio" name="roleInput" value="CEO"><span>CEO</span></label>
                    <label class="role-option"><input type="radio" name="roleInput" value="sales"><span>sales</span></label>
                    <label class="role-option"><input type="radio" name="roleInput" value="manager"><span>manager</span></label>
                    <label class="role-option"><input type="radio" name="roleInput" value="accounting"><span>accounting</span></label>
                </div>
            </div>

            <div class="advanced-permissions mt-4">
                <button type="button" class="toggle-btn" onclick="const wrapper = this.nextElementSibling; wrapper.classList.toggle('hidden');">
                    <span>⚙️ กำหนดสิทธิ์รายเมนู (Advanced)</span>
                    <span class="chevron">▼</span>
                </button>
                
                <div class="permissions-wrapper hidden pt-3">
                    <div class="permissions-container">
                        ${dynamicMenuHtml}
                    </div>
                </div>
            </div>
        `).join('') : '';

        card.innerHTML = `
            <div class="card-header multiple-users">
                <div class="store-info mb-2" style="font-size:0.8rem; color:#475569; padding-bottom: 0.5rem;">
                    <strong style="color:#1e293b; font-size:0.9rem;">🏬 ${sanitize(req.storeName || 'N/A')}</strong> (ID: ${sanitize(req.storeId || 'N/A')})
                </div>
                <div class="users-stack">
                    ${usersHtml}
                </div>
            </div>
            <div class="card-footer">
                <span class="req-status ${req.status.toLowerCase()}">${sanitize(req.status)}</span>
                <span class="req-date">${formatDate(req.createdAt)}</span>
            </div>
        `;
        requestsList.appendChild(card);
    });
};

const setupRealtimeListener = () => {
    const q = query(requestsCollection, orderBy('createdAt', 'desc'));
    onSnapshot(q, (snapshot) => {
        const requests = [];
        snapshot.forEach((doc) => requests.push({ id: doc.id, ...doc.data() }));
        renderRequests(requests);
    }, (error) => {
        console.error('Error fetching requests: ', error);
        onSnapshot(requestsCollection, (fallbackSnap) => {
           const fbReqs = [];
           fallbackSnap.forEach((doc) => fbReqs.push({id: doc.id, ...doc.data()}));
           renderRequests(fbReqs);
        });
    });
};

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

            setupRealtimeListener();
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
