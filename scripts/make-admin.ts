/**
 * Script to grant admin privileges to a user by email.
 *
 * Usage:
 *   ADMIN_EMAIL=user@company.com npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/make-admin.ts
 *
 * Requirements:
 *   - The user must have signed in at least once (so their account exists in Firestore)
 *   - FIREBASE_ADMIN_* env vars must be set (or use GOOGLE_APPLICATION_CREDENTIALS)
 */

import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const email = process.env.ADMIN_EMAIL;
if (!email) {
  console.error("Error: ADMIN_EMAIL environment variable is required");
  console.error(
    "Usage: ADMIN_EMAIL=user@company.com npx ts-node scripts/make-admin.ts"
  );
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

  const auth = admin.auth();
  const db = admin.firestore();

  try {
    // Find user by email
    const userRecord = await auth.getUserByEmail(email);
    console.log(`Found user: ${userRecord.displayName} (${userRecord.uid})`);

    // Set admin flag in Firestore
    await db.collection("users").doc(userRecord.uid).set(
      {
        email: userRecord.email,
        displayName: userRecord.displayName,
        isAdmin: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    console.log(`✓ Successfully granted admin privileges to ${email}`);
    console.log("  They will have admin access on their next sign-in.");
  } catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") {
      console.error(
        `Error: No user found with email ${email}. The user must sign in first.`
      );
    } else {
      console.error("Error:", error);
    }
    process.exit(1);
  }
}

makeAdmin(email).then(() => process.exit(0));
