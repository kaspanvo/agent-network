import { Mark } from "../Brand";

const COLORS = ["#2457d6", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#0369a1"];

function colorFor(name: string): string {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return COLORS[sum % COLORS.length]!;
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.42 }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function AgentAvatar({ size = 32 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center justify-center rounded-full bg-ink" style={{ width: size, height: size }}>
      <Mark size={Math.round(size * 0.4)} />
    </span>
  );
}

export function AvatarStack({ names, size = 28 }: { names: string[]; size?: number }) {
  const shown = names.slice(0, 3);
  return (
    <span aria-hidden="true" className="flex shrink-0">
      {shown.map((name, i) => (
        <span key={name} className="rounded-full ring-2 ring-white" style={{ marginLeft: i === 0 ? 0 : -size * 0.35 }}>
          <Avatar name={name} size={size} />
        </span>
      ))}
      {names.length > 3 && (
        <span className="flex items-center justify-center rounded-full bg-line text-[11px] font-semibold text-slate ring-2 ring-white" style={{ width: size, height: size, marginLeft: -size * 0.35 }}>
          +{names.length - 3}
        </span>
      )}
    </span>
  );
}
