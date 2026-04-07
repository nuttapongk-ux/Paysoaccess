import { db } from './firebase-config.js';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// DOM Elements
const form = document.getElementById('accessRequestForm');
const submitBtn = document.getElementById('submitBtn');
const btnText = submitBtn.querySelector('.btn-text');
const loader = submitBtn.querySelector('.loader');
const statusMessage = document.getElementById('statusMessage');
const requestsList = document.getElementById('requestsList');

// Firestore Collection Reference
const requestsCollection = collection(db, 'access_requests');

// UI State Management for Form
const setSubmitting = (isSubmitting) => {
    submitBtn.disabled = isSubmitting;
    if (isSubmitting) {
        btnText.classList.add('hidden');
        loader.classList.remove('hidden');
    } else {
        btnText.classList.remove('hidden');
        loader.classList.add('hidden');
    }
};

const showMessage = (msg, type = 'success') => {
    statusMessage.textContent = msg;
    statusMessage.className = `status-message ${type}`;
    setTimeout(() => {
        statusMessage.textContent = '';
        statusMessage.className = 'status-message';
    }, 5000);
};

// Handle Form Submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setSubmitting(true);

    const formData = {
        firstName: form.firstName.value.trim(),
        lastName: form.lastName.value.trim(),
        email: form.email.value.trim(),
        department: form.department.value.trim(),
        requestedRole: form.requestedRole.value,
        justification: form.justification.value.trim(),
        permissions: Array.from(form.querySelectorAll('input[name="permissions"]:checked')).map(el => el.value),
        status: 'Pending', // Default status
        createdAt: serverTimestamp()
    };

    try {
        await addDoc(requestsCollection, formData);
        form.reset();
        showMessage('Request submitted successfully!');
    } catch (error) {
        console.error('Error adding document: ', error);
        showMessage('Failed to submit request: ' + error.message, 'error');
    } finally {
        setSubmitting(false);
    }
});

// Format Date safely
const formatDate = (timestamp) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate();
    return new Intl.DateTimeFormat('en-US', { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    }).format(date);
};

// Render Request Cards
const renderRequests = (requests) => {
    requestsList.innerHTML = ''; // Clear loading/empty state

    if (requests.length === 0) {
        requestsList.innerHTML = `<div class="empty-state">No requests found. Create one to get started!</div>`;
        return;
    }

    requests.forEach(req => {
        const card = document.createElement('div');
        card.className = 'request-card';
        
        // Sanitize to prevent basic XSS
        const sanitize = str => String(str).replace(/[&<>"']/g, match => {
            const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return escapeMap[match];
        });

        card.innerHTML = `
            <div class="card-header">
                <div class="user-info">
                    <strong>${sanitize(req.firstName)} ${sanitize(req.lastName)}</strong>
                    <span>${sanitize(req.email)} • ${sanitize(req.department)}</span>
                </div>
                <div class="role-badge">${sanitize(req.requestedRole)}</div>
            </div>
            <div class="card-body">
                <p>"${sanitize(req.justification)}"</p>
                <div class="perms-badges">
                    ${req.permissions && req.permissions.length > 0 ? req.permissions.map(p => `<span class="perm-badge">${sanitize(p)}</span>`).join('') : '<span class="perm-badge empty">No specific menus</span>'}
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

// Real-time listener for requests
const setupRealtimeListener = () => {
    // Query ordered by creation time descending (newest first)
    const q = query(requestsCollection, orderBy('createdAt', 'desc'));
    
    onSnapshot(q, (snapshot) => {
        const requests = [];
        snapshot.forEach((doc) => {
            requests.push({ id: doc.id, ...doc.data() });
        });
        renderRequests(requests);
    }, (error) => {
        console.error('Error fetching requests: ', error);
        if (error.code === 'failed-precondition' || error.message.includes('index')) {
             requestsList.innerHTML = `<div class="empty-state" style="color:red; font-size: 0.8rem;">
                 Firestore Index needed to sort by createdAt. Check console for index link, or if offline, check connection.<br/><br/>
                 Loading without sort as fallback...
             </div>`;
             
             // Fallback query without orderBy if index is missing
             onSnapshot(requestsCollection, (fallbackSnap) => {
                const fbReqs = [];
                fallbackSnap.forEach((doc) => fbReqs.push({id: doc.id, ...doc.data()}));
                renderRequests(fbReqs);
             });
        } else {
             requestsList.innerHTML = `<div class="empty-state" style="color:red;">Error loading requests: ${error.message}</div>`;
        }
    });
};

// Initialize
setupRealtimeListener();
