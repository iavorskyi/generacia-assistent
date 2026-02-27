"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

const messages: Record<string, string> = {
  AccessDenied:
    "Access denied. Only company email addresses are allowed to sign in.",
  OAuthSignin: "Error starting the sign-in process. Please try again.",
  OAuthCallback: "Error completing sign-in. Please try again.",
  default: "An error occurred during sign-in. Please try again.",
};

function ErrorMessage() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  return (
    <p className="text-gray-500 mb-8">
      {messages[error ?? "default"] ?? messages.default}
    </p>
  );
}

export default function AuthErrorPage() {
  return (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-red-600 text-3xl">✕</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Sign-in Failed
        </h1>
        <Suspense fallback={<p className="text-gray-500 mb-8">{messages.default}</p>}>
          <ErrorMessage />
        </Suspense>
        <Link
          href="/auth/signin"
          className="inline-block bg-blue-600 text-white rounded-lg px-6 py-3 font-medium hover:bg-blue-700 transition-colors"
        >
          Try Again
        </Link>
      </div>
    </div>
  );
}
