"use client";

import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client";
import type { AboutNote, ProfileIntent } from "@/server/domain";
import type { ChatItem, IntakeEvent } from "@/server/intake/types";
import type { AgentEvent, CheckIn } from "@/server/negotiation/types";
import type { PublicSession } from "@/server/store";
import { emptyRun, reduce, type RunState } from "./runState";

export function useIntake() {
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [intents, setIntents] = useState<ProfileIntent[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [about, setAbout] = useState<AboutNote[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback((session: PublicSession) => {
    setChat(session.chat);
    setIntents(session.intents);
    setGoals(session.goals);
    setAbout(session.about);
    setReady(session.ready);
  }, []);

  const apply = (event: IntakeEvent) => {
    const onItem = (id: string, change: (m: ChatItem) => ChatItem) => setChat((c) => c.map((m) => (m.id === id ? change(m) : m)));
    switch (event.type) {
      case "agent_start":
        return setChat((c) => [...c, { id: event.itemId, role: "agent", text: "" }]);
      case "text":
        return onItem(event.itemId, (m) => ({ ...m, text: m.text + event.delta }));
      case "widget":
        return onItem(event.itemId, (m) => ({ ...m, widget: event.widget }));
      case "activity":
        return onItem(event.itemId, (m) => ({ ...m, activity: [...(m.activity ?? []), event.text] }));
      case "suggestions":
        return onItem(event.itemId, (m) => ({ ...m, suggestions: event.options }));
      case "intent":
        return setIntents((list) => (list.some((i) => i.id === event.intent.id) ? list.map((i) => (i.id === event.intent.id ? event.intent : i)) : [...list, event.intent]));
      case "about":
        setGoals(event.goals);
        return setAbout(event.about);
      case "ready":
        return setReady(true);
      case "error":
        return setError(event.message);
    }
  };

  // `echo` is what the person sees as their own message; `answeredId` closes the widget they used.
  // Resolves true when this turn made the agent ready to go out.
  const send = async (input: unknown, echo?: string, answeredId?: string): Promise<boolean> => {
    let becameReady = false;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    setChat((c) => [
      ...c.map((m) => (m.id === answeredId || (echo && m.widget && !m.answered) ? { ...m, answered: true } : m)),
      ...(echo ? [{ id: `local-${Date.now()}`, role: "user" as const, text: echo }] : []),
    ]);
    try {
      for await (const event of await api.intake(input, controller.signal)) {
        if (event.type === "ready") becameReady = true;
        apply(event);
      }
    } catch (err) {
      if (controller.signal.aborted) setChat((c) => c.map((m, i) => (i === c.length - 1 && m.role === "agent" ? { ...m, stopped: true } : m)));
      else setError((err as Error).message);
    } finally {
      abort.current = null;
      setBusy(false);
    }
    return becameReady;
  };

  const stop = () => abort.current?.abort();

  // Asks the agent to show the recap again, without a message from the person.
  const refresh = () => send({ kind: "refresh" });

  const decideIntent = async (id: string, status: "confirmed" | "rejected") => {
    try {
      const result = await api.setIntent(id, status);
      setIntents(result.intents);
      setReady(result.ready);
      // The recap was already checked, so what changed needs checking too before the agent can go out.
      if (result.recapNeeded) await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return { chat, intents, goals, about, ready, busy, error, load, send, stop, decideIntent, refresh, setError };
}

export function useRun(onEvent?: (event: AgentEvent | { type: "done" }) => void) {
  const [run, setRun] = useState<RunState>(emptyRun);
  const [running, setRunning] = useState(false);
  // The room that's streaming right now, when the stream belongs to one room.
  const [busyRoom, setBusyRoom] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<PublicSession["decisions"]>({});

  const load = useCallback((session: PublicSession) => {
    setDecisions(session.decisions);
    if (session.run) setRun(session.run.events.reduce(reduce, emptyRun));
  }, []);

  // Returns what the server said it needs first ("recap"), when it refused for a reason the app can fix itself.
  const stream = async (events: Promise<AsyncGenerator<AgentEvent | { type: "done" }>>, room: string | null = null): Promise<string | undefined> => {
    setRunning(true);
    setBusyRoom(room);
    try {
      for await (const event of await events) {
        setRun((s) => reduce(s, event));
        if (event.type === "decision") setDecisions((d) => ({ ...d, [event.opportunityId]: event.decision }));
        if (event.type === "hold" && event.stage === "lapsed") setDecisions((d) => ({ ...d, [event.opportunityId]: "lapsed" }));
        onEvent?.(event);
      }
    } catch (err) {
      if (err instanceof ApiError && err.needs) return err.needs;
      setRun((s) => ({ ...s, error: (err as Error).message }));
    } finally {
      setRunning(false);
      setBusyRoom(null);
    }
    return undefined;
  };

  // The page was reopened while the agent was out: pick the run up live from where the saved events end.
  // Only one follower at a time: React runs mount effects twice in development, and a second follower would replay events.
  const following = useRef(false);
  const resume = async (after: number, room: string | null = null) => {
    if (following.current) return;
    following.current = true;
    try {
      await stream(api.follow(after), room);
    } finally {
      following.current = false;
    }
  };

  const start = async () => {
    setRun(emptyRun);
    setDecisions({});
    return stream(api.run());
  };

  const renegotiate = async (threadId: string, limit: number) => {
    setRun((s) => ({ ...s, error: null, activeId: threadId }));
    await stream(api.renegotiate(threadId, limit), threadId);
    const { session } = await api.session();
    if (session) setDecisions(session.decisions);
  };

  // A yes or no streams back what happens next in the room: the others' answers, the introduction, the check-in.
  const decide = async (id: string, decision: "approved" | "declined") => {
    const opportunity = run.opportunities.find((o) => o.id === id);
    setDecisions((d) => ({ ...d, [id]: decision }));
    await stream(api.decide(id, decision, opportunity?.version), opportunity?.threadId ?? null);
    // A refused answer (the proposal lapsed or changed) leaves the server's record as the truth.
    const { session } = await api.session();
    if (session) setDecisions(session.decisions);
  };

  // Asks the others to hold a proposal a day longer.
  const extend = async (id: string) => {
    const threadId = run.opportunities.find((o) => o.id === id)?.threadId ?? null;
    await stream(api.hold(id), threadId);
  };

  const checkIn = async (id: string, answer: CheckIn) => {
    const threadId = run.opportunities.find((o) => o.id === id)?.threadId ?? null;
    await stream(api.checkIn(id, answer), threadId);
  };

  // The person writes in a room; the other agents' replies stream back into it.
  const say = async (threadId: string, text: string) => {
    setRun((s) => ({ ...s, error: null, activeId: threadId }));
    await stream(api.say(threadId, text), threadId);
  };

  // Opens a one-to-one room with someone's agent and resolves to its id.
  const openPrivate = async (name: string): Promise<string | null> => {
    const existing = run.threads.find((t) => t.mode === "private" && t.who === name);
    if (existing) return existing.id;
    let id: string | null = null;
    await stream(
      api.openPrivate(name).then(async function* (events) {
        for await (const event of events) {
          if (event.type === "discover") id = event.threadId;
          yield event;
        }
      }),
    );
    return id;
  };

  return { run, running, busyRoom, decisions, load, resume, start, renegotiate, decide, extend, checkIn, say, openPrivate };
}
