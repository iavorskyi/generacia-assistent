import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getAdminDb } from "@/lib/firebase-admin";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
      if (allowedDomain && user.email) {
        if (!user.email.endsWith(`@${allowedDomain}`)) {
          return false; // reject non-company emails
        }
      }
      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;

        // Check if user is admin
        try {
          const db = getAdminDb();
          const userDoc = await db.collection("users").doc(token.sub).get();
          const userData = userDoc.data();
          session.user.isAdmin = userData?.isAdmin === true;
        } catch {
          session.user.isAdmin = false;
        }
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
};
