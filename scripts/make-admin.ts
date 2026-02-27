/**
 * Script to grant admin privileges to a user by email.
 *
 * Usage:
 *   npm run make-admin -- user@example.com
 *
 * Requirements:
 *   - The user must have signed in at least once (so their record exists in Firestore)
 *   - FIREBASE_ADMIN_* env vars must be set in .env.local
 */

import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

// Accept email from CLI arg or ADMIN_EMAIL env var
const email = process.argv[2] || process.env.ADMIN_EMAIL;
if (!email) {
  console.error("Error: provide email as argument or set ADMIN_EMAIL");
  console.error("Usage: npm run make-admin -- user@example.com");
  process.exit(1);
}

async function makeAdmin(email: string) {
  // Initialize Firebase Admin
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
          /\\n/g,
          "\n"
        ),
      }),
    });
  }

  const db = admin.firestore();

  // Query Firestore users collection by email
  const snapshot = await db
    .collection("users")
    .where("email", "==", email)
    .limit(1)
    .get();

  if (snapshot.empty) {
    console.error(
      `Error: No user found with email ${email}.\nThe user must sign in to the app at least once first.`
    );
    process.exit(1);
  }

  const userDoc = snapshot.docs[0];
  await userDoc.ref.set({ isAdmin: true }, { merge: true });

  const data = userDoc.data();
  console.log(`✓ Successfully granted admin privileges to ${email}`);
  console.log(`  User: ${data.displayName ?? "(no name)"} — Firestore ID: ${userDoc.id}`);
  console.log("  They will have admin access on their next sign-in.");
}

makeAdmin(email).then(() => process.exit(0)).catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
