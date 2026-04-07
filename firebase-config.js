// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBp6fLBaT9QlTdLwkeZi33rTaDtKdXed-o",
  authDomain: "reborn-9e91c.firebaseapp.com",
  projectId: "reborn-9e91c",
  storageBucket: "reborn-9e91c.firebasestorage.app",
  messagingSenderId: "505598028148",
  appId: "1:505598028148:web:17c48622f411220e1ee421",
  measurementId: "G-T7MW1Q9X2P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Firestore and get a reference to the service
const db = getFirestore(app);

export { db };
