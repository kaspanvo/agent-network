import type { Metadata } from "next";
import { StartApp } from "@/components/start/StartApp";

export const metadata: Metadata = { title: "Set up your agent · Open" };

export default function StartPage() {
  return <StartApp />;
}
