export type SignalData =
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit | null };

export type SignalPayload = {
  to: string;
  from: string;
  data: SignalData;
};

export type ChatMessage = {
  id: string;
  from: string;
  text: string;
  ts: number;
  fromDB?: boolean;
};

export type RemoteStreams = Record<string, MediaStream>;
