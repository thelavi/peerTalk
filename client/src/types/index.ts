export type SignalData =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit | null };

export type ChatMessage = {
  id: string;
  from: string;
  text: string;
  ts: number;
};

export type RemoteStreams = Record<string, MediaStream>;
