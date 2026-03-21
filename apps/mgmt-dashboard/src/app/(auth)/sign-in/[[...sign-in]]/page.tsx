"use client";

import { signIn } from "next-auth/react";

export default function Page() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">
          Sign in
        </h1>
        <button
          type="button"
          onClick={() => signIn("authentik")}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
        >
          Sign in with Authentik
        </button>
      </div>
    </div>
  );
}
