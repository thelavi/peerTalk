// Minimal hand-rolled DB types. Regenerate via `supabase gen types typescript`
// once the project is linked to overwrite this file.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          last_seen_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          avatar_url?: string | null;
          last_seen_at?: string | null;
        };
        Update: {
          id?: string;
          username?: string;
          display_name?: string;
          avatar_url?: string | null;
          last_seen_at?: string | null;
        };
        Relationships: [];
      };
      rooms: {
        Row: {
          id: string;
          slug: string;
          name: string;
          owner_id: string;
          is_private: boolean;
          max_participants: number;
          created_at: string;
        };
        Insert: {
          slug: string;
          name: string;
          owner_id: string;
          is_private?: boolean;
          max_participants?: number;
        };
        Update: {
          slug?: string;
          name?: string;
          is_private?: boolean;
          max_participants?: number;
        };
        Relationships: [];
      };
      room_members: {
        Row: {
          room_id: string;
          user_id: string;
          role: "owner" | "member";
          joined_at: string;
        };
        Insert: {
          room_id: string;
          user_id: string;
          role?: "owner" | "member";
        };
        Update: {
          role?: "owner" | "member";
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          room_id: string;
          sender_id: string;
          body: string;
          created_at: string;
          edited_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          room_id: string;
          sender_id: string;
          body: string;
        };
        Update: {
          body?: string;
          edited_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [];
      };
      call_sessions: {
        Row: {
          id: string;
          room_id: string;
          initiator_id: string;
          started_at: string;
          ended_at: string | null;
        };
        Insert: {
          room_id: string;
          initiator_id: string;
        };
        Update: {
          ended_at?: string | null;
        };
        Relationships: [];
      };
      call_participants: {
        Row: {
          call_id: string;
          user_id: string;
          joined_at: string;
          left_at: string | null;
          duration_seconds: number | null;
        };
        Insert: {
          call_id: string;
          user_id: string;
        };
        Update: {
          left_at?: string | null;
          duration_seconds?: number | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      member_role: "owner" | "member";
    };
    CompositeTypes: Record<string, never>;
  };
};
