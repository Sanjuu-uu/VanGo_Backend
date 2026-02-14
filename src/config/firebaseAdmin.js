import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

// Standard initialization using Environment Variables
const serviceAccount = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  // This version is "bulletproof" against formatting errors
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/^"|"$/g, '')
    : undefined,
};

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("Firebase Admin Initialized successfully");
  } catch (error) {
    console.error("Firebase Admin initialization error:", error.message);
  }
}

export const messaging = admin.messaging();
export default admin;