import type { Metadata } from "next";
import { SignInReturn } from "@/components/account/SignInReturn";

export const metadata: Metadata = { title: "Signing in · Open", robots: { index: false } };

export default function SignInReturnPage() {
  return <SignInReturn />;
}
