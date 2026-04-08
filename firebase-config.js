// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, setPersistence, inMemoryPersistence } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBp6fLBaT9QlTdLwkeZi33rTaDtKdXed-o",
  authDomain: "reborn-9e91c.firebaseapp.com",
  projectId: "reborn-9e91c",
  storageBucket: "reborn-9e91c.firebasestorage.app",
  messagingSenderId: "505598028148",
  appId: "1:505598028148:web:17c48622f411220e1ee421",
  measurementId: "G-T7MW1Q9X2P"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
setPersistence(auth, inMemoryPersistence);
