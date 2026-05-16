import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";

export type Room = Database["public"]["Tables"]["rooms"]["Row"];

// Mirror server check constraint `^[a-z0-9-]{3,40}$` exactly — no /i flag.
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

export function useRooms(userId: string | null) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLoading(false);
    if (error) {
      console.error("[useRooms.refresh]", error);
      return;
    }
    setRooms(data ?? []);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createRoom = useCallback(
    async (slug: string, name: string, isPrivate = false) => {
      if (!userId) throw new Error("not authenticated");
      const normalised = slug.trim().toLowerCase();
      if (!SLUG_RE.test(normalised)) {
        throw new Error("slug must be 3-40 chars, lowercase letters/digits/dash");
      }
      const { data, error } = await supabase
        .from("rooms")
        .insert({
          slug: normalised,
          name: name.trim() || normalised,
          owner_id: userId,
          is_private: isPrivate,
        })
        .select("*")
        .single();
      if (error) throw error;
      await refresh();
      return data;
    },
    [refresh, userId]
  );

  const joinRoomMembership = useCallback(
    async (roomId: string) => {
      if (!userId) throw new Error("not authenticated");
      const { error } = await supabase
        .from("room_members")
        .upsert(
          { room_id: roomId, user_id: userId, role: "member" },
          { onConflict: "room_id,user_id" }
        );
      if (error && error.code !== "23505") {
        console.error("[joinRoomMembership]", error);
      }
    },
    [userId]
  );

  return { rooms, loading, refresh, createRoom, joinRoomMembership };
}
