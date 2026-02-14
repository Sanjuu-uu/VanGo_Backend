import admin from "firebase-admin";

if (!admin.apps.length) {
  try {
    const rawKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!rawKey) {
      throw new Error("FIREBASE_PRIVATE_KEY is missing from .env");
    }

    // Advanced cleaning: Removes accidental quotes, fixes \n, and trims whitespace
    const formattedKey = rawKey
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\\n/g, '\n');

    

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: formattedKey,
      }),
    });

    console.log("✅ Firebase Admin Initialized successfully");
  } catch (error) {
    console.error("❌ Firebase Admin initialization error:", error.message);
    process.exit(1); 
  }
}

export const messaging = admin.messaging();
export default admin;