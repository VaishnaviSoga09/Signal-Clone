"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  Search, Settings, MessageSquarePlus, LogOut, Send, Paperclip, 
  Smile, UserPlus, Users, Trash2, X, ShieldAlert, Clock, MoreVertical, Check, CheckCheck, ArrowLeft
} from "lucide-react";
import { useAuth } from "./AuthContext";
import { api, User, Message, Conversation, WS_BASE, getToken } from "./api";

export default function Dashboard() {
  const { user, logout, refreshUser } = useAuth();
  const router = useRouter();

  // Core state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<User[]>([]);

  // Input state
  const [messageText, setMessageText] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [showMessageSearch, setShowMessageSearch] = useState(false);

  // Real-time states
  const [typingUsers, setTypingUsers] = useState<{ [convId: number]: { [userId: number]: boolean } }>({});
  const [userStatuses, setUserStatuses] = useState<{ [userId: number]: { is_online: boolean; last_seen: string } }>({});

  // Modals state
  const [showSettings, setShowSettings] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showChatDetails, setShowChatDetails] = useState(false);

  // Form states
  const [editName, setEditName] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [theme, setTheme] = useState("light");

  const [contactPhone, setContactPhone] = useState("");
  const [contactSearchResult, setContactSearchResult] = useState<User | null>(null);
  const [addContactError, setAddContactError] = useState("");

  const [groupName, setGroupName] = useState("");
  const [groupAvatar, setGroupAvatar] = useState("");
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<number[]>([]);

  const [groupAddMemberPhone, setGroupAddMemberPhone] = useState("");
  const [groupAddMemberError, setGroupAddMemberError] = useState("");

  const [isMobile, setIsMobile] = useState(false);

  // Refs
  const ws = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Check window size on client
  useEffect(() => {
    if (typeof window !== "undefined") {
      const handleResize = () => {
        setIsMobile(window.innerWidth < 768);
      };
      handleResize();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  // Initialize
  useEffect(() => {
    if (!user) return;
    setEditName(user.display_name || "");
    setEditAvatar(user.avatar || "");
    const storedTheme = localStorage.getItem("signal_theme") || "light";
    setTheme(storedTheme);

    fetchInitialData();
    connectWebSocket();

    return () => {
      if (ws.current) ws.current.close();
    };
  }, [user]);

  // Fetch initial chats & contacts
  const fetchInitialData = async () => {
    try {
      const [convs, conts] = await Promise.all([
        api.getConversations(),
        api.getContacts()
      ]);
      setConversations(convs);
      setContacts(conts);

      // Cache online statuses of contacts
      const statuses: typeof userStatuses = {};
      conts.forEach(c => {
        statuses[c.id] = { is_online: c.is_online, last_seen: c.last_seen };
      });
      setUserStatuses(prev => ({ ...prev, ...statuses }));
    } catch (err) {
      console.error("Failed to load initial data", err);
    }
  };

  // Connect WebSockets
  const connectWebSocket = () => {
    const token = getToken();
    if (!token) return;

    const socketUrl = `${WS_BASE}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(socketUrl);
    ws.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      const { event_type, data } = parsed;

      switch (event_type) {
        case "message_new":
          handleNewMessageWS(data);
          break;
        case "messages_read":
          handleMessagesReadWS(data);
          break;
        case "typing":
          handleTypingWS(data);
          break;
        case "user_status":
          handleUserStatusWS(data);
          break;
        case "reaction_new":
          handleReactionNewWS(data);
          break;
        case "reaction_delete":
          handleReactionDeleteWS(data);
          break;
        case "conversation_new":
          fetchInitialData(); // Refresh list
          break;
      }
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected, retrying in 3 seconds...");
      setTimeout(connectWebSocket, 3000);
    };

    socket.onerror = (err) => {
      console.error("WebSocket error", err);
      socket.close();
    };
  };

  // WS Event Handlers
  const handleNewMessageWS = (msg: Message) => {
    // Add message to active chat if open
    if (activeConversation && activeConversation.id === msg.conversation_id) {
      setMessages(prev => {
        // Prevent duplicates
        if (prev.some(m => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      // Scroll to bottom
      scrollToBottom();

      // Trigger Read Receipt immediately if sent by others
      if (msg.sender_id !== user?.id) {
        // Triggering standard API to mark read, which dispatches status_update
        api.getMessages(msg.conversation_id).catch(console.error);
      }
    } else {
      // Increment unread count in sidebar
      setConversations(prev => prev.map(c => {
        if (c.id === msg.conversation_id) {
          return {
            ...c,
            last_message: msg,
            unread_count: c.unread_count + (msg.sender_id !== user?.id ? 1 : 0)
          };
        }
        return c;
      }));
    }

    // Update last message in sidebar
    setConversations(prev => {
      const sorted = prev.map(c => {
        if (c.id === msg.conversation_id) {
          return { ...c, last_message: msg };
        }
        return c;
      });
      // Re-sort
      return [...sorted].sort((a, b) => {
        const timeA = a.last_message ? new Date(a.last_message.created_at).getTime() : new Date(a.created_at).getTime();
        const timeB = b.last_message ? new Date(b.last_message.created_at).getTime() : new Date(b.created_at).getTime();
        return timeB - timeA;
      });
    });
  };

  const handleMessagesReadWS = (data: { conversation_id: number; user_id: number; message_ids: number[] }) => {
    if (activeConversation && activeConversation.id === data.conversation_id) {
      setMessages(prev => prev.map(m => {
        if (data.message_ids.includes(m.id)) {
          // If status already exists for this user, update it, else add it
          const existingStatus = m.statuses.find(s => s.user_id === data.user_id);
          let newStatuses = [...m.statuses];
          if (existingStatus) {
            newStatuses = newStatuses.map(s => s.user_id === data.user_id ? { ...s, status: "read" as const } : s);
          } else {
            newStatuses.push({
              message_id: m.id,
              user_id: data.user_id,
              status: "read",
              updated_at: new Date().toISOString()
            });
          }
          return { ...m, statuses: newStatuses };
        }
        return m;
      }));
    }
  };

  const handleTypingWS = (data: { conversation_id: number; user_id: number; is_typing: boolean }) => {
    setTypingUsers(prev => {
      const convTyping = prev[data.conversation_id] || {};
      const updated = {
        ...prev,
        [data.conversation_id]: {
          ...convTyping,
          [data.user_id]: data.is_typing
        }
      };
      return updated;
    });
  };

  const handleUserStatusWS = (data: { user_id: number; is_online: boolean; last_seen: string }) => {
    setUserStatuses(prev => ({
      ...prev,
      [data.user_id]: { is_online: data.is_online, last_seen: data.last_seen }
    }));
  };

  const handleReactionNewWS = (react: any) => {
    setMessages(prev => prev.map(m => {
      if (m.id === react.message_id) {
        // Prevent duplicate reactions for same user
        const filteredReactions = m.reactions.filter(r => r.user_id !== react.user_id);
        return {
          ...m,
          reactions: [...filteredReactions, react]
        };
      }
      return m;
    }));
  };

  const handleReactionDeleteWS = (data: { message_id: number; user_id: number }) => {
    setMessages(prev => prev.map(m => {
      if (m.id === data.message_id) {
        return {
          ...m,
          reactions: m.reactions.filter(r => r.user_id !== data.user_id)
        };
      }
      return m;
    }));
  };

  // Typing state trigger
  const handleMessageTyping = () => {
    if (!activeConversation || !ws.current) return;

    // Send typing: true
    sendTypingIndicator(true);

    // Debounce typing: false
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTypingIndicator(false);
    }, 2500);
  };

  const sendTypingIndicator = (isTyping: boolean) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && activeConversation) {
      ws.current.send(JSON.stringify({
        event_type: "typing",
        conversation_id: activeConversation.id,
        is_typing: isTyping
      }));
    }
  };

  // Scroll messages to bottom
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  // Fetch messages when selecting a chat
  const handleSelectConversation = async (conv: Conversation) => {
    setActiveConversation(conv);
    setReplyingTo(null);
    setMessageText("");
    setMessageSearchQuery("");
    setShowMessageSearch(false);
    
    // Clear typing indicator timeouts
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      sendTypingIndicator(false);
    }

    try {
      const history = await api.getMessages(conv.id);
      setMessages(history);
      scrollToBottom();

      // Clear unread counts locally
      setConversations(prev => prev.map(c => {
        if (c.id === conv.id) return { ...c, unread_count: 0 };
        return c;
      }));
    } catch (err) {
      console.error("Failed to load message history", err);
    }
  };

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !activeConversation) return;

    const tempText = messageText;
    setMessageText("");
    setReplyingTo(null);

    // Send typing: false
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendTypingIndicator(false);

    try {
      // Call REST api to create
      // Check disappearing setting from activeConversation metadata or state
      // (Normally stored on conversation settings or passed manually)
      const disappearTimer = disappearingMessages[activeConversation.id] || null;
      await api.sendMessage(
        activeConversation.id,
        tempText,
        replyingTo?.id,
        disappearTimer
      );
    } catch (err) {
      console.error("Failed to send message", err);
    }
  };

  // Attachment upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConversation) return;

    try {
      const disappearTimer = disappearingMessages[activeConversation.id] || null;
      await api.sendAttachment(activeConversation.id, file, replyingTo?.id, disappearTimer);
    } catch (err) {
      console.error("Failed to send attachment", err);
    }
  };

  // Reactions
  const handleMessageReact = async (messageId: number, emoji: string) => {
    try {
      const activeMsg = messages.find(m => m.id === messageId);
      const userReaction = activeMsg?.reactions.find(r => r.user_id === user?.id);
      
      if (userReaction && userReaction.emoji === emoji) {
        // Delete reaction if clicking the same one
        await api.deleteReaction(messageId);
      } else {
        await api.addReaction(messageId, emoji);
      }
    } catch (err) {
      console.error("Failed to react to message", err);
    }
  };

  // Search User to add contact
  const handleSearchContact = async () => {
    if (!contactPhone.trim()) return;
    setAddContactError("");
    setContactSearchResult(null);

    try {
      const results = await api.searchUsers(contactPhone);
      if (results.length > 0) {
        // Find exact match or first result
        const match = results.find(u => u.phone === contactPhone) || results[0];
        setContactSearchResult(match);
      } else {
        setAddContactError("No user found with this phone number or name.");
      }
    } catch (err) {
      setAddContactError("Search failed.");
    }
  };

  const handleAddContactSubmit = async () => {
    if (!contactSearchResult) return;

    try {
      const newContact = await api.addContact(contactSearchResult.phone);
      setContacts(prev => [...prev, newContact]);
      setShowAddContact(false);
      setContactPhone("");
      setContactSearchResult(null);
      // Auto-start conversation
      const newConv = await api.createConversation([newContact.id], false);
      setConversations(prev => {
        if (prev.some(c => c.id === newConv.id)) return prev;
        return [newConv, ...prev];
      });
      handleSelectConversation(newConv);
    } catch (err) {
      setAddContactError(err instanceof Error ? err.message : "Failed to add contact.");
    }
  };

  // Group creation
  const handleCreateGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim() || selectedGroupMembers.length === 0) return;

    try {
      const newGroup = await api.createConversation(
        selectedGroupMembers,
        true,
        groupName,
        groupAvatar || undefined
      );
      setConversations(prev => [newGroup, ...prev]);
      handleSelectConversation(newGroup);
      
      // Close & reset
      setShowCreateGroup(false);
      setGroupName("");
      setGroupAvatar("");
      setSelectedGroupMembers([]);
    } catch (err) {
      console.error(err);
    }
  };

  const toggleSelectGroupMember = (userId: number) => {
    setSelectedGroupMembers(prev => 
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  // Group settings & add member
  const handleAddGroupMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConversation || !groupAddMemberPhone.trim()) return;
    setGroupAddMemberError("");

    try {
      const searchRes = await api.searchUsers(groupAddMemberPhone);
      const userToAdd = searchRes.find(u => u.phone === groupAddMemberPhone);
      if (!userToAdd) {
        setGroupAddMemberError("User not found.");
        return;
      }

      const updatedConv = await api.addGroupMembers(activeConversation.id, [userToAdd.id]);
      setActiveConversation(updatedConv);
      setConversations(prev => prev.map(c => c.id === updatedConv.id ? updatedConv : c));
      setGroupAddMemberPhone("");
    } catch (err) {
      setGroupAddMemberError("Failed to add member.");
    }
  };

  const handleRemoveGroupMember = async (userId: number) => {
    if (!activeConversation) return;

    try {
      const updatedConv = await api.removeGroupMember(activeConversation.id, userId);
      if (userId === user?.id) {
        // If left group
        setActiveConversation(null);
        setConversations(prev => prev.filter(c => c.id !== updatedConv.id));
      } else {
        setActiveConversation(updatedConv);
        setConversations(prev => prev.map(c => c.id === updatedConv.id ? updatedConv : c));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePromoteGroupMember = async (userId: number) => {
    if (!activeConversation) return;

    try {
      const updatedConv = await api.promoteGroupMember(activeConversation.id, userId);
      setActiveConversation(updatedConv);
      setConversations(prev => prev.map(c => c.id === updatedConv.id ? updatedConv : c));
    } catch (err) {
      console.error(err);
    }
  };

  // Profile Save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateMe(editName, editAvatar);
      await refreshUser();
      setShowSettings(false);
    } catch (err) {
      console.error(err);
    }
  };

  // Theme Toggle
  const handleToggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("signal_theme", nextTheme);
    if (nextTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  // Keyboard shortcut handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes current chat
      if (e.key === "Escape") {
        if (replyingTo) {
          setReplyingTo(null);
        } else if (showSettings || showAddContact || showCreateGroup || showChatDetails) {
          setShowSettings(false);
          setShowAddContact(false);
          setShowCreateGroup(false);
          setShowChatDetails(false);
        } else if (activeConversation) {
          setActiveConversation(null);
        }
      }

      // Ctrl+K or Cmd+K focuses search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeConversation, replyingTo, showSettings, showAddContact, showCreateGroup, showChatDetails]);

  const formatLastSeen = (userId: number) => {
    const status = userStatuses[userId];
    if (!status) return "Offline";
    if (status.is_online) return "Online";
    
    try {
      const lastSeenDate = new Date(status.last_seen);
      const now = new Date();
      const diffSec = Math.floor((now.getTime() - lastSeenDate.getTime()) / 1000);
      
      if (isNaN(diffSec) || diffSec < 0) return "Offline";
      if (diffSec < 60) return "last seen just now";
      
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `last seen ${diffMin}m ago`;
      
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `last seen ${diffHour}h ago`;
      
      const diffDay = Math.floor(diffHour / 24);
      if (diffDay < 7) return `last seen ${diffDay}d ago`;
      
      return "last seen recently";
    } catch (e) {
      return "Offline";
    }
  };

  // Sidebar Conversation List filtering
  const filteredConversations = useMemo(() => {
    return conversations.filter(c => {
      const name = c.is_group ? c.name : c.members.find(m => m.user_id !== user?.id)?.user.display_name;
      return name?.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [conversations, searchQuery, user]);

  // Filter messages within current chat
  const filteredMessages = useMemo(() => {
    if (!messageSearchQuery.trim()) return messages;
    return messages.filter(m => m.content?.toLowerCase().includes(messageSearchQuery.toLowerCase()));
  }, [messages, messageSearchQuery]);

  // Typing users display string
  const typingString = useMemo(() => {
    if (!activeConversation) return "";
    const activeConvTyping = typingUsers[activeConversation.id] || {};
    const typists = Object.keys(activeConvTyping)
      .filter(uid => activeConvTyping[Number(uid)])
      .map(uid => activeConversation.members.find(m => m.user_id === Number(uid))?.user.display_name)
      .filter(Boolean);

    if (typists.length === 0) return "";
    if (typists.length === 1) return `${typists[0]} is typing...`;
    return `${typists.join(", ")} are typing...`;
  }, [typingUsers, activeConversation]);

  // Disappearing messages settings local store (maps conversationId -> seconds duration)
  const [disappearingMessages, setDisappearingMessages] = useState<{ [convId: number]: number | null }>({});

  const handleSetDisappearingTimer = (sec: number | null) => {
    if (!activeConversation) return;
    setDisappearingMessages(prev => ({
      ...prev,
      [activeConversation.id]: sec
    }));
  };

  // Live expiring countdown tracker on client
  const [expiringTimes, setExpiringTimes] = useState<{ [msgId: number]: number }>({});

  useEffect(() => {
    const interval = setInterval(() => {
      setExpiringTimes(prev => {
        const next = { ...prev };
        let changed = false;
        
        Object.keys(next).forEach(idKey => {
          const msgId = Number(idKey);
          if (next[msgId] <= 1) {
            delete next[msgId];
            // Remove the expired message from UI state
            setMessages(currentMessages => currentMessages.filter(m => m.id !== msgId));
            changed = true;
          } else {
            next[msgId] = next[msgId] - 1;
            changed = true;
          }
        });

        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Track countdown trigger: when message is rendered, if it has disappear_after and is read by current user, trigger timer
  useEffect(() => {
    messages.forEach(msg => {
      if (msg.disappear_after && !expiringTimes[msg.id]) {
        // If read by current user
        const myStatus = msg.statuses.find(s => s.user_id === user?.id);
        if (myStatus && myStatus.status === "read") {
          // Calculate elapsed seconds since update
          const start = new Date(myStatus.updated_at).getTime();
          const now = new Date().getTime();
          const elapsedSec = Math.floor((now - start) / 1000);
          const remaining = msg.disappear_after - elapsedSec;
          
          if (remaining > 0) {
            setExpiringTimes(prev => ({ ...prev, [msg.id]: remaining }));
          } else {
            // Already expired - clean up from view
            setMessages(prev => prev.filter(m => m.id !== msg.id));
          }
        }
      }
    });
  }, [messages, user]);

  return (
    <div style={styles.appContainer}>
      {/* 1. LEFT SIDEBAR */}
      {(!isMobile || !activeConversation) && (
        <div style={styles.sidebar}>
          {/* Sidebar Header */}
          <div style={styles.sidebarHeader}>
            <img
              src={user?.avatar || ""}
              alt="My Profile"
              style={styles.profileAvatar}
              onClick={() => setShowSettings(true)}
              title="Profile Settings"
            />
            <div style={styles.headerTitle}>Signal</div>
            <div style={styles.headerIcons}>
              <button onClick={() => setShowAddContact(true)} title="Add Contact">
                <UserPlus size={20} />
              </button>
              <button onClick={() => setShowCreateGroup(true)} title="Create Group">
                <Users size={20} />
              </button>
              <button onClick={() => setShowSettings(true)} title="Settings">
                <Settings size={20} />
              </button>
              <button onClick={logout} title="Log Out" style={{ color: "#ff4d4d" }}>
                <LogOut size={20} />
              </button>
            </div>
          </div>

          {/* Sidebar Search */}
          <div style={styles.searchBarContainer}>
            <div style={styles.searchBar}>
              <Search size={16} style={{ color: "var(--text-secondary)" }} />
              <input
                type="text"
                placeholder="Search conversations"
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
            </div>
          </div>

          {/* Conversation List */}
          <div style={styles.conversationList}>
            {filteredConversations.length === 0 ? (
              <div style={styles.noChats}>No conversations found.</div>
            ) : (
              filteredConversations.map((conv) => {
                const isGroup = conv.is_group;
                const otherUser = !isGroup ? conv.members.find(m => m.user_id !== user?.id)?.user : null;
                const displayName = isGroup ? conv.name : otherUser?.display_name || "Unknown User";
                const avatarUrl = isGroup ? conv.avatar : otherUser?.avatar;
                const isOnline = !isGroup && otherUser ? userStatuses[otherUser.id]?.is_online : false;

                const isSelected = activeConversation?.id === conv.id;

                // Format date of last message
                let lastMsgTimeStr = "";
                if (conv.last_message) {
                  const date = new Date(conv.last_message.created_at);
                  lastMsgTimeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                return (
                  <div
                    key={conv.id}
                    onClick={() => handleSelectConversation(conv)}
                    style={{
                      ...styles.conversationItem,
                      backgroundColor: isSelected ? "var(--sb-active)" : "transparent"
                    }}
                    className="conv-item-hover"
                  >
                    <div style={styles.avatarWrapper}>
                      <img src={avatarUrl || ""} alt={displayName || ""} style={styles.chatAvatar} />
                      {isOnline && <div style={styles.onlineIndicator} />}
                    </div>

                    <div style={styles.conversationInfo}>
                      <div style={styles.conversationInfoTop}>
                        <span style={styles.chatName}>{displayName}</span>
                        <span style={styles.chatTime}>{lastMsgTimeStr}</span>
                      </div>

                      <div style={styles.conversationInfoBottom}>
                        <span style={styles.lastMessagePreview}>
                          {conv.last_message?.sender_id === user?.id ? "You: " : ""}
                          {conv.last_message?.message_type === "attachment" 
                            ? `📎 Attachment: ${conv.last_message.attachment_name}` 
                            : conv.last_message?.content || "No messages yet."}
                        </span>
                        {conv.unread_count > 0 && (
                          <span style={styles.unreadBadge}>{conv.unread_count}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* 2. CHAT AREA */}
      {(!isMobile || activeConversation) && (
        <div style={styles.chatPane}>
        {activeConversation ? (
          <>
            {/* Chat Pane Header */}
            <div style={styles.chatHeader}>
              {isMobile && (
                <button 
                  onClick={() => setActiveConversation(null)} 
                  style={{ marginRight: "12px", color: "var(--text-secondary)" }}
                  title="Back to conversations list"
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <div 
                style={styles.chatHeaderInfo} 
                onClick={() => setShowChatDetails(true)}
                title="View Conversation details"
              >
                <img
                  src={activeConversation.is_group 
                    ? activeConversation.avatar || "" 
                    : activeConversation.members.find(m => m.user_id !== user?.id)?.user.avatar || ""}
                  alt="Avatar"
                  style={styles.headerAvatar}
                />
                <div>
                  <div style={styles.headerName}>
                    {activeConversation.is_group 
                      ? activeConversation.name 
                      : activeConversation.members.find(m => m.user_id !== user?.id)?.user.display_name}
                  </div>
                  <div style={styles.headerStatus}>
                    {typingString || (
                      activeConversation.is_group 
                        ? `${activeConversation.members.length} members`
                        : formatLastSeen(activeConversation.members.find(m => m.user_id !== user?.id)?.user.id || 0)
                    )}
                  </div>
                </div>
              </div>

              <div style={styles.headerControls}>
                {disappearingMessages[activeConversation.id] && (
                  <div style={styles.activeDisappearBadge} title="Disappearing messages active">
                    <Clock size={16} />
                    <span>{disappearingMessages[activeConversation.id]}s</span>
                  </div>
                )}
                
                <button 
                  onClick={() => setShowMessageSearch(!showMessageSearch)} 
                  title="Search Messages"
                >
                  <Search size={20} />
                </button>
                <button 
                  onClick={() => setShowChatDetails(true)} 
                  title="Chat Options"
                >
                  <MoreVertical size={20} />
                </button>
              </div>
            </div>

            {/* Message Search Sub-bar */}
            {showMessageSearch && (
              <div style={styles.msgSearchSubbar} className="animate-fade">
                <input
                  type="text"
                  placeholder="Filter messages in this conversation"
                  value={messageSearchQuery}
                  onChange={(e) => setMessageSearchQuery(e.target.value)}
                  style={styles.msgSearchInput}
                  autoFocus
                />
                <button onClick={() => { setMessageSearchQuery(""); setShowMessageSearch(false); }}>
                  <X size={18} />
                </button>
              </div>
            )}

            {/* Messages Scroll Area */}
            <div style={styles.messagesContainer}>
              {(() => {
                let lastDateStr = "";
                return filteredMessages.map((msg) => {
                  const isMe = msg.sender_id === user?.id;
                  
                  // Format the message date
                  const msgDateObj = new Date(msg.created_at);
                  const msgYear = msgDateObj.getFullYear();
                  const msgMonth = msgDateObj.getMonth();
                  const msgDay = msgDateObj.getDate();
                  const currentDateStr = `${msgYear}-${msgMonth}-${msgDay}`;
                  
                  let dateHeader = null;
                  if (currentDateStr !== lastDateStr) {
                    lastDateStr = currentDateStr;
                    
                    const today = new Date();
                    const yesterday = new Date();
                    yesterday.setDate(today.getDate() - 1);
                    
                    let dateLabel = "";
                    if (msgYear === today.getFullYear() && msgMonth === today.getMonth() && msgDay === today.getDate()) {
                      dateLabel = "Today";
                    } else if (msgYear === yesterday.getFullYear() && msgMonth === yesterday.getMonth() && msgDay === yesterday.getDate()) {
                      dateLabel = "Yesterday";
                    } else {
                      dateLabel = msgDateObj.toLocaleDateString(undefined, { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      });
                    }
                    
                    dateHeader = (
                      <div key={`date-${msg.id}`} style={{
                        display: "flex",
                        justifyContent: "center",
                        margin: "16px 0",
                        width: "100%"
                      }}>
                        <span style={{
                          backgroundColor: "var(--sb-active)",
                          color: "var(--text-secondary)",
                          fontSize: "12px",
                          fontWeight: 500,
                          padding: "4px 12px",
                          borderRadius: "12px",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                        }}>
                          {dateLabel}
                        </span>
                      </div>
                    );
                  }
                  
                  // Get delivery status
                  let isReadByAll = false;
                  if (isMe && activeConversation) {
                    // Checks if every member except user has read
                    const otherMembers = activeConversation.members.filter(m => m.user_id !== user?.id);
                    isReadByAll = otherMembers.length > 0 && otherMembers.every(m => {
                      const statusObj = msg.statuses.find(s => s.user_id === m.user_id);
                      return statusObj && statusObj.status === "read";
                    });
                  }

                  // Render reactions list
                  const emojiCounts = msg.reactions.reduce((acc: { [emoji: string]: number }, r) => {
                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                    return acc;
                  }, {});

                  return (
                    <React.Fragment key={msg.id}>
                      {dateHeader}
                      <div
                        style={{
                          ...styles.messageRow,
                          justifyContent: isMe ? "flex-end" : "flex-start"
                        }}
                      >
                        {!isMe && activeConversation.is_group && (
                          <span style={styles.groupSenderName}>
                            {msg.sender.display_name}
                          </span>
                        )}

                        <div style={styles.bubbleWrapper}>
                          {/* Quote Reply if present */}
                          {msg.replied_to && (
                            <div style={styles.quoteBubble}>
                              <div style={styles.quoteSender}>
                                {msg.replied_to.sender_id === user?.id ? "You" : 
                                  activeConversation.members.find(m => m.user_id === msg.replied_to?.sender_id)?.user.display_name || "User"}
                              </div>
                              <div style={styles.quoteContent}>
                                {msg.replied_to.message_type === "attachment" 
                                  ? "📎 Attachment" 
                                  : msg.replied_to.content}
                              </div>
                            </div>
                          )}

                          {/* Main Bubble */}
                          <div
                            style={{
                              ...styles.messageBubble,
                              backgroundColor: isMe ? "var(--bubble-out)" : "var(--bubble-in)",
                              color: isMe ? "var(--bubble-out-text)" : "var(--bubble-in-text)"
                            }}
                          >
                            {/* Disappearing badge on message */}
                            {msg.disappear_after && (
                              <div style={styles.msgDisappearClock}>
                                <Clock size={11} />
                                <span>
                                  {expiringTimes[msg.id] !== undefined ? `${expiringTimes[msg.id]}s` : `${msg.disappear_after}s`}
                                </span>
                              </div>
                            )}

                            {/* Attachment display */}
                            {msg.message_type === "attachment" ? (
                              <div style={styles.attachmentView}>
                                <Paperclip size={16} />
                                <a
                                  href={`http://localhost:8000${msg.attachment_path}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    color: isMe ? "#ffffff" : "var(--bubble-out)",
                                    fontWeight: 500
                                  }}
                                >
                                  {msg.attachment_name}
                                </a>
                              </div>
                            ) : (
                              <div>{msg.content}</div>
                            )}

                            {/* Bubble Timestamp and delivery checks */}
                            <div style={styles.bubbleFooter}>
                              <span style={styles.messageTime}>
                                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              
                              {isMe && (
                                <span style={styles.readReceipt}>
                                  {isReadByAll ? (
                                    <CheckCheck size={14} style={{ color: "#76a9ff" }} /> // Blue ticks
                                  ) : (
                                    <Check size={14} /> // Single check
                                  )}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Reactions Row */}
                          {Object.keys(emojiCounts).length > 0 && (
                            <div style={styles.reactionsContainer}>
                              {Object.keys(emojiCounts).map(emoji => (
                                <button
                                  key={emoji}
                                  onClick={() => handleMessageReact(msg.id, emoji)}
                                  style={styles.reactionPill}
                                >
                                  {emoji} <span style={{ fontSize: "11px" }}>{emojiCounts[emoji]}</span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Hover Emoji Selector */}
                          <div className="hover-reactions" style={styles.hoverReactionsPanel}>
                            {["👍", "❤️", "😂", "😮", "😢", "🙏"].map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => handleMessageReact(msg.id, emoji)}
                                style={styles.emojiReactionBtn}
                              >
                                {emoji}
                              </button>
                            ))}
                            <button 
                              onClick={() => setReplyingTo(msg)} 
                              style={styles.emojiReplyBtn}
                              title="Reply to message"
                            >
                              Quote
                            </button>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                });
              })()}
              <div ref={messagesEndRef} />
            </div>

            {/* Replying Preview Bar */}
            {replyingTo && (
              <div style={styles.replyPreviewBar} className="animate-slide">
                <div style={styles.replyPreviewInfo}>
                  <div style={styles.replyPreviewSender}>
                    Replying to {replyingTo.sender_id === user?.id ? "yourself" : replyingTo.sender.display_name}
                  </div>
                  <div style={styles.replyPreviewContent}>
                    {replyingTo.message_type === "attachment" ? "📎 Attachment" : replyingTo.content}
                  </div>
                </div>
                <button onClick={() => setReplyingTo(null)}>
                  <X size={18} />
                </button>
              </div>
            )}

            {/* Chat Pane Footer / Message input form */}
            <form onSubmit={handleSendMessage} style={styles.chatInputForm}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={styles.attachmentButton}
                title="Send File Attachment"
              >
                <Paperclip size={20} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />

              <div style={styles.textInputWrapper}>
                <input
                  type="text"
                  placeholder="New message"
                  value={messageText}
                  onChange={(e) => {
                    setMessageText(e.target.value);
                    handleMessageTyping();
                  }}
                  style={styles.chatTextInput}
                />
              </div>

              <button type="submit" style={styles.sendButton} title="Send">
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <div style={styles.emptyChatPlaceholder}>
            <svg width="128" height="128" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.15 }}>
              <circle cx="128" cy="128" r="120" fill="var(--text-primary)" />
              <path d="M128 50C85 50 50 85 50 128C50 148 57.5 166.5 70 180.5L60 210L91.5 200.5C102.5 204 115 206 128 206C171 206 206 171 206 128C206 85 171 50 128 50Z" fill="var(--sb-bg)" />
              <circle cx="128" cy="128" r="28" fill="var(--text-primary)" />
            </svg>
            <h2 style={{ marginTop: "24px", fontWeight: 500 }}>Select a chat or contact to start messaging.</h2>
          </div>
        )}
      </div>
      )}

      {/* 3. SETTINGS MODAL */}
      {showSettings && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="animate-fade">
            <div style={styles.modalHeader}>
              <h2>Settings</h2>
              <button onClick={() => setShowSettings(false)}>
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSaveProfile} style={styles.modalForm}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Display Name</label>
                <div style={styles.inputBox}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Avatar URL</label>
                <div style={styles.inputBox}>
                  <input
                    type="url"
                    value={editAvatar}
                    onChange={(e) => setEditAvatar(e.target.value)}
                  />
                </div>
              </div>

              <div style={styles.themeToggleContainer}>
                <span>Dark Theme</span>
                <button
                  type="button"
                  onClick={handleToggleTheme}
                  style={{
                    ...styles.toggleBtn,
                    backgroundColor: theme === "dark" ? "#2C6BED" : "#e4e6eb"
                  }}
                >
                  <div style={{
                    ...styles.toggleKnob,
                    transform: theme === "dark" ? "translateX(20px)" : "translateX(0)"
                  }} />
                </button>
              </div>

              <div style={styles.modalFooter}>
                <button type="button" onClick={() => setShowSettings(false)} style={styles.cancelBtn}>
                  Cancel
                </button>
                <button type="submit" style={styles.saveBtn}>
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. ADD CONTACT MODAL */}
      {showAddContact && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="animate-fade">
            <div style={styles.modalHeader}>
              <h2>Add Contact</h2>
              <button onClick={() => setShowAddContact(false)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <div style={{ ...styles.inputBox, flex: 1 }}>
                <input
                  type="text"
                  placeholder="Search by phone (e.g. +12065550101)"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </div>
              <button onClick={handleSearchContact} style={styles.searchBtn}>
                Search
              </button>
            </div>

            {addContactError && <div style={{ color: "#ff4d4d", marginBottom: "16px" }}>{addContactError}</div>}

            {contactSearchResult && (
              <div style={styles.searchResultCard}>
                <img src={contactSearchResult.avatar || ""} style={styles.resultAvatar} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{contactSearchResult.display_name}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{contactSearchResult.phone}</div>
                </div>
                <button onClick={handleAddContactSubmit} style={styles.addBtn}>
                  Add Contact
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. CREATE GROUP MODAL */}
      {showCreateGroup && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="animate-fade">
            <div style={styles.modalHeader}>
              <h2>New Group</h2>
              <button onClick={() => setShowCreateGroup(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateGroupSubmit} style={styles.modalForm}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Group Name</label>
                <div style={styles.inputBox}>
                  <input
                    type="text"
                    placeholder="e.g. Hiking Buds"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Group Avatar URL (Optional)</label>
                <div style={styles.inputBox}>
                  <input
                    type="url"
                    value={groupAvatar}
                    onChange={(e) => setGroupAvatar(e.target.value)}
                  />
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Select Members</label>
                <div style={styles.contactsSelectionList}>
                  {contacts.length === 0 ? (
                    <div style={{ padding: "8px 0", color: "var(--text-secondary)" }}>No contacts found. Add contacts first!</div>
                  ) : (
                    contacts.map(c => (
                      <label key={c.id} style={styles.contactSelectLabel}>
                        <input
                          type="checkbox"
                          checked={selectedGroupMembers.includes(c.id)}
                          onChange={() => toggleSelectGroupMember(c.id)}
                          style={{ marginRight: "8px" }}
                        />
                        <span>{c.display_name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div style={styles.modalFooter}>
                <button type="button" onClick={() => setShowCreateGroup(false)} style={styles.cancelBtn}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  style={styles.saveBtn} 
                  disabled={!groupName.trim() || selectedGroupMembers.length === 0}
                >
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. CHAT DETAILS MODAL */}
      {showChatDetails && activeConversation && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="animate-fade">
            <div style={styles.modalHeader}>
              <h2>Conversation Settings</h2>
              <button onClick={() => setShowChatDetails(false)}>
                <X size={20} />
              </button>
            </div>

            {/* Disappearing Messages Settings */}
            <div style={styles.detailsSection}>
              <h3 style={styles.sectionHeader}>Disappearing Messages</h3>
              <div style={styles.disappearTimerOptions}>
                {[
                  { label: "Off", val: null },
                  { label: "10s", val: 10 },
                  { label: "30s", val: 30 },
                  { label: "1hr", val: 3600 },
                  { label: "1day", val: 86400 }
                ].map(opt => {
                  const current = disappearingMessages[activeConversation.id] ?? null;
                  const isSelected = current === opt.val;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => handleSetDisappearingTimer(opt.val)}
                      style={{
                        ...styles.timerOptionBtn,
                        backgroundColor: isSelected ? "#2C6BED" : "var(--chat-bg)",
                        color: isSelected ? "#ffffff" : "var(--text-primary)"
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Group members section */}
            {activeConversation.is_group && (
              <div style={styles.detailsSection}>
                <h3 style={styles.sectionHeader}>Group Members ({activeConversation.members.length})</h3>
                <div style={styles.membersList}>
                  {activeConversation.members.map(m => {
                    const isSelf = m.user_id === user?.id;
                    const amIAdmin = activeConversation.members.find(memb => memb.user_id === user?.id)?.is_admin;
                    return (
                      <div key={m.user_id} style={styles.memberListItem}>
                        <img src={m.user.avatar || ""} style={styles.memberListAvatar} />
                        <div style={{ flex: 1 }}>
                          <span>{m.user.display_name} {isSelf && "(You)"}</span>
                          {m.is_admin && <span style={styles.adminBadge}>Admin</span>}
                        </div>
                        <div style={{ display: "flex", gap: "10px" }}>
                          {amIAdmin && !isSelf && !m.is_admin && (
                            <button 
                              onClick={() => handlePromoteGroupMember(m.user_id)} 
                              style={{ color: "#2C6BED", fontSize: "13px", fontWeight: 500 }}
                              title="Promote to Admin"
                            >
                              Promote
                            </button>
                          )}
                          {amIAdmin && !isSelf && (
                            <button 
                              onClick={() => handleRemoveGroupMember(m.user_id)} 
                              style={{ color: "#ff4d4d", fontSize: "13px", fontWeight: 500 }}
                              title="Remove Member"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add Member Form (Admin only) */}
                {activeConversation.members.find(memb => memb.user_id === user?.id)?.is_admin && (
                  <form onSubmit={handleAddGroupMemberSubmit} style={{ marginTop: "16px" }}>
                    <label style={styles.label}>Add Member (Enter Phone Number)</label>
                    <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                      <div style={{ ...styles.inputBox, flex: 1 }}>
                        <input
                          type="text"
                          placeholder="e.g. +12065550102"
                          value={groupAddMemberPhone}
                          onChange={(e) => setGroupAddMemberPhone(e.target.value)}
                        />
                      </div>
                      <button type="submit" style={styles.searchBtn}>Add</button>
                    </div>
                    {groupAddMemberError && <div style={{ color: "#ff4d4d", fontSize: "12px", marginTop: "4px" }}>{groupAddMemberError}</div>}
                  </form>
                )}
              </div>
            )}

            {/* Leave/Delete Button */}
            <div style={{ marginTop: "24px", display: "flex", justifyContent: "flex-end" }}>
              {activeConversation.is_group ? (
                <button
                  onClick={() => handleRemoveGroupMember(user?.id || 0)}
                  style={styles.dangerBtn}
                >
                  Leave Group
                </button>
              ) : (
                <button
                  onClick={() => {
                    // Simulating conversation deletion locally
                    setConversations(prev => prev.filter(c => c.id !== activeConversation.id));
                    setActiveConversation(null);
                    setShowChatDetails(false);
                  }}
                  style={styles.dangerBtn}
                >
                  Delete Conversation
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Global CSS overrides for hover states since inline JS has limits */}
      <style jsx global>{`
        .conv-item-hover:hover {
          background-color: var(--sb-hover) !important;
        }
        .bubble-wrapper-outer {
          position: relative;
        }
        /* Reveal reactions panel on hover */
        div[style*="justify-content"] > div:hover .hover-reactions {
          opacity: 1 !important;
          visibility: visible !important;
        }
      `}</style>
    </div>
  );
}

// Inline styles utilizing CSS variables
const styles = {
  appContainer: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    backgroundColor: "var(--sb-bg)",
    color: "var(--text-primary)"
  },
  sidebar: {
    width: "350px",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column" as const,
    height: "100%"
  },
  sidebarHeader: {
    padding: "16px",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    borderBottom: "1px solid var(--border)"
  },
  profileAvatar: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    cursor: "pointer",
    objectFit: "cover" as const
  },
  headerTitle: {
    fontSize: "18px",
    fontWeight: 600,
    flex: 1
  },
  headerIcons: {
    display: "flex",
    gap: "16px",
    color: "var(--text-secondary)"
  },
  searchBarContainer: {
    padding: "8px 16px"
  },
  searchBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    backgroundColor: "var(--chat-bg)",
    borderRadius: "8px",
    padding: "8px 12px"
  },
  searchInput: {
    flex: 1,
    border: "none",
    background: "none",
    outline: "none"
  },
  conversationList: {
    flex: 1,
    overflowY: "auto" as const
  },
  noChats: {
    padding: "24px",
    textAlign: "center" as const,
    color: "var(--text-secondary)"
  },
  conversationItem: {
    display: "flex",
    padding: "12px 16px",
    gap: "12px",
    alignItems: "center",
    cursor: "pointer",
    transition: "background-color 0.2s"
  },
  avatarWrapper: {
    position: "relative" as const
  },
  chatAvatar: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    objectFit: "cover" as const
  },
  onlineIndicator: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    backgroundColor: "#2ecc71",
    position: "absolute" as const,
    bottom: "2px",
    right: "2px",
    border: "2px solid var(--sb-bg)"
  },
  conversationInfo: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    overflow: "hidden"
  },
  conversationInfoTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  chatName: {
    fontWeight: 600,
    fontSize: "15px",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const
  },
  chatTime: {
    fontSize: "12px",
    color: "var(--text-secondary)"
  },
  conversationInfoBottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  },
  lastMessagePreview: {
    fontSize: "13px",
    color: "var(--text-secondary)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    flex: 1
  },
  unreadBadge: {
    backgroundColor: "#2C6BED",
    color: "#ffffff",
    borderRadius: "50%",
    fontSize: "11px",
    fontWeight: 600,
    width: "18px",
    height: "18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },

  // CHAT PANE
  chatPane: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    backgroundColor: "var(--chat-bg)",
    height: "100%"
  },
  chatHeader: {
    height: "69px",
    padding: "0 24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottom: "1px solid var(--border)",
    backgroundColor: "var(--sb-bg)"
  },
  chatHeaderInfo: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    cursor: "pointer"
  },
  headerAvatar: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    objectFit: "cover" as const
  },
  headerName: {
    fontWeight: 600,
    fontSize: "15px"
  },
  headerStatus: {
    fontSize: "12px",
    color: "#2ecc71",
    fontWeight: 500
  },
  headerControls: {
    display: "flex",
    alignItems: "center",
    gap: "20px",
    color: "var(--text-secondary)"
  },
  activeDisappearBadge: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    backgroundColor: "var(--border)",
    color: "var(--text-secondary)",
    padding: "4px 8px",
    borderRadius: "12px",
    fontSize: "11px",
    fontWeight: 500
  },
  msgSearchSubbar: {
    display: "flex",
    alignItems: "center",
    padding: "8px 24px",
    backgroundColor: "var(--sb-bg)",
    borderBottom: "1px solid var(--border)",
    gap: "12px"
  },
  msgSearchInput: {
    flex: 1,
    padding: "6px 12px",
    backgroundColor: "var(--chat-bg)",
    borderRadius: "6px",
    border: "1px solid var(--border)"
  },
  messagesContainer: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "24px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px"
  },
  messageRow: {
    display: "flex",
    flexDirection: "column" as const,
    width: "100%"
  },
  groupSenderName: {
    fontSize: "11px",
    fontWeight: 500,
    color: "var(--text-secondary)",
    marginBottom: "2px",
    marginLeft: "12px"
  },
  bubbleWrapper: {
    maxWidth: "65%",
    position: "relative" as const,
    display: "flex",
    flexDirection: "column" as const
  },
  messageBubble: {
    padding: "10px 14px",
    borderRadius: "16px",
    fontSize: "14px",
    lineHeight: "1.4",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
    position: "relative" as const,
    display: "flex",
    flexDirection: "column" as const
  },
  quoteBubble: {
    backgroundColor: "rgba(0, 0, 0, 0.05)",
    borderLeft: "3px solid #2C6BED",
    padding: "6px 10px",
    borderRadius: "4px 4px 0 0",
    fontSize: "12px",
    marginBottom: "-4px",
    opacity: 0.8
  },
  quoteSender: {
    fontWeight: 600,
    fontSize: "11px",
    color: "#2C6BED",
    marginBottom: "2px"
  },
  quoteContent: {
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const
  },
  attachmentView: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 0"
  },
  msgDisappearClock: {
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "10px",
    opacity: 0.7,
    marginBottom: "4px"
  },
  bubbleFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "4px",
    marginTop: "4px",
    fontSize: "10px",
    opacity: 0.7,
    alignSelf: "flex-end"
  },
  messageTime: {
    fontSize: "10px"
  },
  readReceipt: {
    display: "inline-flex"
  },
  reactionsContainer: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "4px",
    marginTop: "4px",
    alignSelf: "flex-start"
  },
  reactionPill: {
    backgroundColor: "var(--sb-bg)",
    border: "1px solid var(--border)",
    padding: "2px 6px",
    borderRadius: "10px",
    fontSize: "12px",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
  },
  hoverReactionsPanel: {
    position: "absolute" as const,
    top: "-36px",
    right: 0,
    backgroundColor: "var(--sb-bg)",
    border: "1px solid var(--border)",
    borderRadius: "20px",
    padding: "4px 8px",
    display: "flex",
    gap: "4px",
    boxShadow: "0 4px 8px rgba(0,0,0,0.1)",
    opacity: 0,
    visibility: "hidden" as const,
    transition: "opacity 0.15s, visibility 0.15s",
    zIndex: 10
  },
  emojiReactionBtn: {
    fontSize: "16px",
    padding: "2px",
    borderRadius: "50%"
  },
  emojiReplyBtn: {
    fontSize: "11px",
    padding: "2px 6px",
    backgroundColor: "var(--chat-bg)",
    borderRadius: "10px",
    fontWeight: 500
  },

  // REPLY PREVIEW
  replyPreviewBar: {
    padding: "8px 24px",
    backgroundColor: "var(--sb-bg)",
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between"
  },
  replyPreviewInfo: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "2px"
  },
  replyPreviewSender: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#2C6BED"
  },
  replyPreviewContent: {
    fontSize: "13px",
    color: "var(--text-secondary)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    maxWidth: "400px"
  },

  // INPUT
  chatInputForm: {
    padding: "16px 24px",
    backgroundColor: "var(--sb-bg)",
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    gap: "12px"
  },
  attachmentButton: {
    color: "var(--text-secondary)"
  },
  textInputWrapper: {
    flex: 1,
    backgroundColor: "var(--chat-bg)",
    borderRadius: "20px",
    padding: "8px 16px"
  },
  chatTextInput: {
    width: "100%",
    border: "none",
    background: "none",
    outline: "none"
  },
  sendButton: {
    color: "#ffffff",
    backgroundColor: "#2C6BED",
    borderRadius: "50%",
    width: "36px",
    height: "36px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  emptyChatPlaceholder: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-secondary)"
  },

  // MODALS
  modalOverlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100
  },
  modalCard: {
    width: "400px",
    backgroundColor: "var(--sb-bg)",
    borderRadius: "16px",
    padding: "24px",
    border: "1px solid var(--border)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.15)"
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "20px"
  },
  modalForm: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px"
  },
  formGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px"
  },
  label: {
    fontSize: "12px",
    fontWeight: 500,
    color: "var(--text-secondary)"
  },
  inputBox: {
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 14px",
    backgroundColor: "var(--chat-bg)"
  },
  themeToggleContainer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0"
  },
  toggleBtn: {
    width: "44px",
    height: "24px",
    borderRadius: "12px",
    padding: "2px",
    display: "flex",
    alignItems: "center",
    transition: "background-color 0.2s"
  },
  toggleKnob: {
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    backgroundColor: "#ffffff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    transition: "transform 0.2s"
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    marginTop: "16px"
  },
  cancelBtn: {
    padding: "8px 16px",
    borderRadius: "6px",
    backgroundColor: "var(--chat-bg)"
  },
  saveBtn: {
    padding: "8px 16px",
    borderRadius: "6px",
    backgroundColor: "#2C6BED",
    color: "#ffffff",
    fontWeight: 500
  },
  searchBtn: {
    backgroundColor: "#2C6BED",
    color: "#ffffff",
    padding: "10px 16px",
    borderRadius: "8px",
    fontWeight: 500
  },
  searchResultCard: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px",
    backgroundColor: "var(--chat-bg)",
    borderRadius: "8px",
    marginTop: "16px",
    border: "1px solid var(--border)"
  },
  resultAvatar: {
    width: "40px",
    height: "40px",
    borderRadius: "50%"
  },
  addBtn: {
    backgroundColor: "#2C6BED",
    color: "#ffffff",
    padding: "8px 12px",
    borderRadius: "6px",
    fontWeight: 500,
    fontSize: "13px"
  },
  contactsSelectionList: {
    maxHeight: "150px",
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px"
  },
  contactSelectLabel: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer"
  },

  // CHAT DETAILS
  detailsSection: {
    borderBottom: "1px solid var(--border)",
    padding: "16px 0"
  },
  sectionHeader: {
    fontSize: "14px",
    fontWeight: 600,
    marginBottom: "12px",
    color: "var(--text-secondary)"
  },
  disappearTimerOptions: {
    display: "flex",
    gap: "8px"
  },
  timerOptionBtn: {
    flex: 1,
    padding: "8px 0",
    borderRadius: "6px",
    fontSize: "13px",
    fontWeight: 500
  },
  membersList: {
    maxHeight: "150px",
    overflowY: "auto" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px"
  },
  memberListItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "14px"
  },
  memberListAvatar: {
    width: "32px",
    height: "32px",
    borderRadius: "50%"
  },
  adminBadge: {
    fontSize: "10px",
    backgroundColor: "var(--border)",
    padding: "2px 6px",
    borderRadius: "10px",
    marginLeft: "6px",
    color: "var(--text-secondary)",
    fontWeight: 500
  },
  dangerBtn: {
    color: "#ff4d4d",
    border: "1px solid #ff4d4d",
    padding: "8px 16px",
    borderRadius: "6px",
    fontWeight: 500
  }
};
