export const API_BASE = "http://localhost:8000/api";
export const WS_BASE = "ws://localhost:8000/api/ws";

// Helper to get token
export const getToken = (): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("signal_token");
  }
  return null;
};

// Helper for authenticated headers
const getHeaders = (isMultipart = false) => {
  const token = getToken();
  const headers: HeadersInit = {};
  if (!isMultipart) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
};

export interface User {
  id: number;
  phone: string;
  display_name: string | null;
  avatar: string | null;
  is_online: boolean;
  last_seen: string;
  created_at: string;
}

export interface ConversationMember {
  conversation_id: number;
  user_id: number;
  is_admin: boolean;
  joined_at: string;
  user: User;
}

export interface MessageStatus {
  message_id: number;
  user_id: number;
  status: "sending" | "sent" | "delivered" | "read";
  updated_at: string;
}

export interface Reaction {
  id: number;
  message_id: number;
  user_id: number;
  emoji: string;
  created_at: string;
  user: {
    id: number;
    phone: string;
    display_name: string | null;
    avatar: string | null;
  };
}

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string | null;
  message_type: "text" | "attachment";
  attachment_path: string | null;
  attachment_name: string | null;
  reply_to_id: number | null;
  replied_to: {
    id: number;
    content: string | null;
    sender_id: number;
    message_type: "text" | "attachment";
  } | null;
  disappear_after: number | null;
  created_at: string;
  sender: User;
  statuses: MessageStatus[];
  reactions: Reaction[];
}

export interface Conversation {
  id: number;
  name: string | null;
  is_group: boolean;
  avatar: string | null;
  created_by: number | null;
  created_at: string;
  members: ConversationMember[];
  last_message: Message | null;
  unread_count: number;
}

export const api = {
  // Auth
  async checkLogin(phone: string) {
    const res = await fetch(`${API_BASE}/auth/login-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    return res.json();
  },

  async register(phone: string, displayName: string, avatar?: string) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, display_name: displayName, avatar }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Registration failed");
    }
    return res.json();
  },

  async verifyOtp(phone: string, otp: string) {
    const res = await fetch(`${API_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, otp }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "OTP verification failed");
    }
    return res.json();
  },

  // Users
  async getMe(): Promise<User> {
    const res = await fetch(`${API_BASE}/users/me`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch profile");
    return res.json();
  },

  async updateMe(displayName: string, avatar: string): Promise<User> {
    const res = await fetch(`${API_BASE}/users/me`, {
      method: "PUT",
      headers: getHeaders(),
      body: JSON.stringify({ phone: "", display_name: displayName, avatar }),
    });
    if (!res.ok) throw new Error("Failed to update profile");
    return res.json();
  },

  async searchUsers(query: string): Promise<User[]> {
    const res = await fetch(`${API_BASE}/users/search?q=${encodeURIComponent(query)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) return [];
    return res.json();
  },

  // Contacts
  async getContacts(): Promise<User[]> {
    const res = await fetch(`${API_BASE}/contacts`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch contacts");
    return res.json();
  },

  async addContact(phone: string): Promise<User> {
    const res = await fetch(`${API_BASE}/contacts`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ contact_phone: phone }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to add contact");
    }
    return res.json();
  },

  // Conversations
  async getConversations(): Promise<Conversation[]> {
    const res = await fetch(`${API_BASE}/conversations`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch conversations");
    return res.json();
  },

  async createConversation(memberIds: number[], isGroup = false, name?: string, avatar?: string): Promise<Conversation> {
    const res = await fetch(`${API_BASE}/conversations`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ member_ids: memberIds, is_group: isGroup, name, avatar }),
    });
    if (!res.ok) throw new Error("Failed to create conversation");
    return res.json();
  },

  async getConversationDetails(id: number): Promise<Conversation> {
    const res = await fetch(`${API_BASE}/conversations/${id}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch conversation details");
    return res.json();
  },

  async addGroupMembers(id: number, userIds: number[]): Promise<Conversation> {
    const res = await fetch(`${API_BASE}/conversations/${id}/members`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(userIds),
    });
    if (!res.ok) throw new Error("Failed to add members");
    return res.json();
  },

  async removeGroupMember(id: number, userId: number): Promise<Conversation> {
    const res = await fetch(`${API_BASE}/conversations/${id}/members/${userId}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to remove member");
    return res.json();
  },

  async promoteGroupMember(id: number, userId: number): Promise<Conversation> {
    const res = await fetch(`${API_BASE}/conversations/${id}/members/${userId}/promote`, {
      method: "PUT",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to promote member");
    return res.json();
  },


  // Messages
  async getMessages(conversationId: number): Promise<Message[]> {
    const res = await fetch(`${API_BASE}/messages/${conversationId}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch messages");
    return res.json();
  },

  async sendMessage(conversationId: number, content: string, replyToId?: number | null, disappearAfter?: number | null): Promise<Message> {
    const res = await fetch(`${API_BASE}/messages`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        conversation_id: conversationId,
        content,
        reply_to_id: replyToId,
        disappear_after: disappearAfter,
      }),
    });
    if (!res.ok) throw new Error("Failed to send message");
    return res.json();
  },

  async sendAttachment(conversationId: number, file: File, replyToId?: number | null, disappearAfter?: number | null): Promise<Message> {
    const formData = new FormData();
    formData.append("conversation_id", conversationId.toString());
    if (replyToId) formData.append("reply_to_id", replyToId.toString());
    if (disappearAfter) formData.append("disappear_after", disappearAfter.toString());
    formData.append("file", file);

    const res = await fetch(`${API_BASE}/messages/attachment`, {
      method: "POST",
      headers: getHeaders(true),
      body: formData,
    });
    if (!res.ok) throw new Error("Failed to upload attachment");
    return res.json();
  },

  async addReaction(messageId: number, emoji: string): Promise<Reaction> {
    const res = await fetch(`${API_BASE}/messages/react`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ message_id: messageId, emoji }),
    });
    if (!res.ok) throw new Error("Failed to add reaction");
    return res.json();
  },

  async deleteReaction(messageId: number): Promise<any> {
    const res = await fetch(`${API_BASE}/messages/react/${messageId}`, {
      method: "DELETE",
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error("Failed to remove reaction");
    return res.json();
  },
};
