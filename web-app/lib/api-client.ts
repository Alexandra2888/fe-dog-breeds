/**
 * API client for communicating with the Go backend
 */

export interface VoiceSessionRequest {
  user_id?: string;
}

export interface VoiceSessionResponse {
  room_name: string;
  token: string;
  url: string;
}

const getBackendUrl = (): string => {
  if (typeof window === "undefined") {
    return process.env.GO_BACKEND_URL || "http://localhost:8080";
  }
  return process.env.NEXT_PUBLIC_GO_BACKEND_URL || "http://localhost:8080";
};

/**
 * Creates a new voice session by requesting a LiveKit room and token from the Go backend
 */
export async function createVoiceSession(
  userId?: string
): Promise<VoiceSessionResponse> {
  const backendUrl = getBackendUrl();

  try {
    const response = await fetch(`${backendUrl}/api/voice/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId || `user-${Date.now()}`,
      } as VoiceSessionRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 404) {
        throw new Error(
          `Voice session endpoint not found. Please ensure the Go backend has the /api/voice/session endpoint implemented. Check ${backendUrl}/api/voice/session`
        );
      }

      throw new Error(
        `Failed to create voice session (${response.status}): ${errorText}`
      );
    }

    return response.json() as Promise<VoiceSessionResponse>;
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot connect to Go backend at ${backendUrl}. Please ensure:\n` +
          `1. Go backend is running on port 8080\n` +
          `2. CORS is enabled in Go backend\n` +
          `3. NEXT_PUBLIC_GO_BACKEND_URL is set correctly in .env.local`
      );
    }
    throw error;
  }
}

/**
 * Ends a voice session (optional cleanup endpoint)
 */
export async function endVoiceSession(roomName: string): Promise<void> {
  const backendUrl = getBackendUrl();
  const response = await fetch(`${backendUrl}/api/voice/session/${roomName}`, {
    method: "DELETE",
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(
      `Failed to end voice session: ${response.status} ${errorText}`
    );
  }
}
