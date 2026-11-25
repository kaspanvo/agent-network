import type { Metadata } from "next";
import { AgentApp } from "@/components/agent/AgentApp";

export const metadata: Metadata = { title: "Your agent · Open" };

export default function AgentPage() {
  return <AgentApp />;
}
