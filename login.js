import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

// DOM Elements
const authForm = document.getElementById('authForm');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const toggleLoginMode = document.getElementById('toggleLoginMode');
const toggleRegisterMode = document.getElementById('toggleRegisterMode');
const nameGroup = document.getElementById('nameGroup');
const statusMessage = document.getElementById('statusMessage');
const authLoader = document.getElementById('authLoader');

let mode = 'login'; // 'login' or 'register'

// Prevent accessing login page if already logged in
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.href = 'index.html';
    }
});

const showMessage = (msg, type = 'success') => {
    statusMessage.textContent = msg;
    statusMessage.className = `status-message mt-2 ${type}`;
};

// Mode Toggles
toggleLoginMode.addEventListener('click', () => {
    mode = 'login';
    toggleLoginMode.classList.add('active');
    toggleRegisterMode.classList.remove('active');
    nameGroup.style.display = 'none';
    authSubmitBtn.innerHTML = `Login <span class="loader hidden" id="authLoader"></span>`;
    statusMessage.textContent = '';
});

toggleRegisterMode.addEventListener('click', () => {
    mode = 'register';
    toggleRegisterMode.classList.add('active');
    toggleLoginMode.classList.remove('active');
    nameGroup.style.display = 'flex';
    authSubmitBtn.innerHTML = `Register <span class="loader hidden" id="authLoader"></span>`;
    statusMessage.textContent = '';
});

authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if(!authEmail.value || !authPassword.value) return;

    authSubmitBtn.disabled = true;
    const loader = authSubmitBtn.querySelector('.loader');
    if(loader) loader.classList.remove('hidden');
    statusMessage.textContent = '';

    try {
        if (mode === 'login') {
            await signInWithEmailAndPassword(auth, authEmail.value, authPassword.value);
            showMessage('Login successful! Redirecting...');
        } else {
            // Firebase limits account creation on weak passwords generally
            if(authPassword.value.length < 6) throw new Error("Password should be at least 6 characters.");
            await createUserWithEmailAndPassword(auth, authEmail.value, authPassword.value);
            showMessage('Registration successful! Redirecting...');
        }
        // Redirect handled naturally by onAuthStateChanged observer above
    } catch (error) {
        console.error(error);
        if(error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'){
            showMessage('Invalid Email or Password.', 'error');
        } else if(error.code === 'auth/email-already-in-use'){
            showMessage('This email is already registered.', 'error');
        } else {
            showMessage(error.message, 'error');
        }
        
        authSubmitBtn.disabled = false;
        if(loader) loader.classList.add('hidden');
    }
});
