import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Row = {
  call_id: string;
  joined_at: string;
  left_at: string | null;
  duration_seconds: number | null;
  call_sessions: {
    id: string;
    started_at: string;
    ended_at: string | null;
    room_id: string;
    rooms: { slug: string; name: string } | null;
  } | null;
};

export const CallHistory: React.FC<{ userId: string }> = ({ userId }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("call_participants")
        .select(
          "call_id, joined_at, left_at, duration_seconds, call_sessions(id, started_at, ended_at, room_id, rooms(slug, name))"
        )
        .eq("user_id", userId)
        .order("joined_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      setLoading(false);
      if (error) {
        console.error("[CallHistory]", error);
        return;
      }
      setRows((data as unknown as Row[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (loading) return <p className="muted">loading history…</p>;
  if (rows.length === 0)
    return <p className="muted">no calls yet — join a room to start</p>;

  return (
    <ul className="history">
      {rows.map((r) => {
        const room = r.call_sessions?.rooms;
        const duration = r.duration_seconds
          ? `${Math.floor(r.duration_seconds / 60)}m ${r.duration_seconds % 60}s`
          : "—";
        return (
          <li key={r.call_id}>
            <strong>{room?.name ?? "deleted room"}</strong>
            <span className="muted"> · {duration}</span>
            <span className="muted"> · {new Date(r.joined_at).toLocaleString()}</span>
          </li>
        );
      })}
    </ul>
  );
};
