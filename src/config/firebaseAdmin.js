import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (!serviceAccountStr) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing from .env");
    }

    // Parse the JSON string from the .env file
    const serviceAccount = JSON.parse(serviceAccountStr);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log("🔥 Firebase Admin Initialized from Service Account JSON.");
  } catch (error) {
    console.error("❌ Firebase Admin initialization error:", error.message);
    process.exit(1);
  }
}

export const messaging = admin.messaging();
export default admin;
