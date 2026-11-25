import Link from "next/link";

export function Mark({ tone = "dark", size = 18 }: { tone?: "dark" | "light"; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-signal-light"
      style={{ width: size, height: size }}
    >
      <span className={`rounded-full ${tone === "dark" ? "bg-cloud" : "bg-ink"}`} style={{ width: size / 3, height: size / 3 }} />
    </span>
  );
}

export function Brand({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <Link href="/" className={`flex min-h-11 items-center gap-2 font-display text-xl font-semibold tracking-tight ${tone === "dark" ? "text-cloud" : "text-ink"}`}>
      <Mark tone={tone} />
      Open
    </Link>
  );
}
