"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Room,
  RoomEvent,
  LocalAudioTrack,
  createLocalAudioTrack,
} from "livekit-client";
import { LIVEKIT_CONFIG } from "@/lib/livekit-config";

interface UseLiveKitReturn {
  isConnected: boolean;
  isRecording: boolean;
  userSpeaking: boolean;
  aiSpeaking: boolean;
  error: string | null;
  toggleRecording: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useLiveKit(): UseLiveKitReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const audioLevelIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const aiAudioCleanupRef = useRef<(() => void) | null>(null);

  const monitorAudioLevel = useCallback(
    (track: MediaStreamTrack, type: "user" | "ai"): (() => void) | null => {
      try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(
          new MediaStream([track])
        );
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const threshold = 30; // Adjust based on sensitivity needs

        const checkAudioLevel = () => {
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;

          if (type === "user") {
            setUserSpeaking(average > threshold);
          } else {
            setAiSpeaking(average > threshold);
          }
        };

        const interval = setInterval(checkAudioLevel, 100);

        if (type === "user") {
          audioLevelIntervalRef.current = interval as unknown as NodeJS.Timeout;
        }

        return () => {
          clearInterval(interval);
          audioContext.close();
        };
      } catch (err) {
        console.error("Error setting up audio monitoring:", err);
        return null;
      }
    },
    []
  );

  const connect = useCallback(async () => {
    try {
      setError(null);

      if (!LIVEKIT_CONFIG.url) {
        throw new Error(
          "LiveKit URL is not configured. Please set NEXT_PUBLIC_LIVEKIT_URL"
        );
      }

      if (!LIVEKIT_CONFIG.token) {
        throw new Error(
          "LiveKit token is not configured. Please set NEXT_PUBLIC_LIVEKIT_TOKEN"
        );
      }

      const room = new Room();
      roomRef.current = room;

      // Set up event listeners
      room.on(RoomEvent.Connected, () => {
        setIsConnected(true);
      });

      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false);
        setIsRecording(false);
        setUserSpeaking(false);
        setAiSpeaking(false);
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        // Monitor AI participant audio when remote tracks are subscribed
        if (track.kind === "audio" && participant !== room.localParticipant) {
          const mediaStreamTrack = track.track as MediaStreamTrack;
          if (mediaStreamTrack) {
            // Clean up previous AI audio monitoring if exists
            if (aiAudioCleanupRef.current) {
              aiAudioCleanupRef.current();
            }
            aiAudioCleanupRef.current = monitorAudioLevel(
              mediaStreamTrack,
              "ai"
            );
          }
        }
      });

      // Connect to room
      await room.connect(LIVEKIT_CONFIG.url, LIVEKIT_CONFIG.token);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to connect to LiveKit";
      setError(errorMessage);
      console.error("LiveKit connection error:", err);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      if (audioLevelIntervalRef.current) {
        clearInterval(audioLevelIntervalRef.current);
        audioLevelIntervalRef.current = null;
      }

      if (aiAudioCleanupRef.current) {
        aiAudioCleanupRef.current();
        aiAudioCleanupRef.current = null;
      }

      if (localAudioTrackRef.current) {
        localAudioTrackRef.current.stop();
        localAudioTrackRef.current = null;
      }

      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }

      setIsConnected(false);
      setIsRecording(false);
      setUserSpeaking(false);
      setAiSpeaking(false);
    } catch (err) {
      console.error("LiveKit disconnect error:", err);
    }
  }, []);

  const toggleRecording = useCallback(async () => {
    if (!roomRef.current) {
      await connect();
      return;
    }

    try {
      if (isRecording) {
        // Stop recording
        if (localAudioTrackRef.current) {
          await roomRef.current.localParticipant.unpublishTrack(
            localAudioTrackRef.current
          );
          localAudioTrackRef.current.stop();
          localAudioTrackRef.current = null;
        }

        if (audioLevelIntervalRef.current) {
          clearInterval(audioLevelIntervalRef.current);
          audioLevelIntervalRef.current = null;
        }

        setUserSpeaking(false);
        setIsRecording(false);
      } else {
        // Start recording
        const localTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });

        localAudioTrackRef.current = localTrack;

        // Publish the track
        await roomRef.current.localParticipant.publishTrack(localTrack, {
          source: 1, // Microphone source
        });

        // Monitor user audio levels
        monitorAudioLevel(localTrack.mediaStreamTrack, "user");

        setIsRecording(true);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to toggle recording";
      setError(errorMessage);
      console.error("Toggle recording error:", err);
    }
  }, [isRecording, connect, monitorAudioLevel]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isRecording,
    userSpeaking,
    aiSpeaking,
    error,
    toggleRecording,
    connect,
    disconnect,
  };
}
