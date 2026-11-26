"use client";

import { useState } from "react";

// For people who aren't members: ask for something an agent said about them to be deleted or corrected.
export function PrivacyRequestForm() {
  const [kind, setKind] = useState<"delete" | "correct" | "question">("delete");
  const [about, setAbout] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" | "error"; message?: string }>({ status: "idle" });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setState({ status: "sending" });
    try {
      const response = await fetch("/api/privacy/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, about, ...(contact.trim() ? { contact } : {}) }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "That didn't go through. Try again in a minute.");
      setState({ status: "sent", message: body.message });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  };

  if (state.status === "sent")
    return (
      <p role="status" className="rounded-2xl bg-live-soft p-5 text-live-ink">
        {state.message}
      </p>
    );

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">What would you like?</legend>
        {(
          [
            ["delete", "Delete what an agent knows or said about me"],
            ["correct", "Correct something an agent said about me"],
            ["question", "Ask a question about my data"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-3">
            <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="size-4 accent-ink" />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="about" className="font-medium">
          What is it about?
        </label>
        <span id="about-help" className="text-sm text-slate">
          For example, which conversation or what was said. Please don&apos;t include anyone else&apos;s details.
        </span>
        <textarea
          id="about"
          aria-describedby="about-help"
          required
          minLength={10}
          maxLength={1500}
          rows={5}
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          className="rounded-xl border border-line bg-white p-3 outline-none focus:border-ink"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contact" className="font-medium">
          How can we reach you? <span className="font-normal text-slate">(optional)</span>
        </label>
        <input id="contact" maxLength={200} value={contact} onChange={(e) => setContact(e.target.value)} className="min-h-11 rounded-xl border border-line bg-white px-3 outline-none focus:border-ink" />
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-signal-ink">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={state.status === "sending" || about.trim().length < 10} className="min-h-12 self-start rounded-full bg-ink px-6 font-semibold text-white disabled:opacity-40">
        {state.status === "sending" ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}
