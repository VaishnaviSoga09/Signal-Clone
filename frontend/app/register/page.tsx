"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../api";

function RegisterContent() {
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") || "";
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    if (!phone) {
      router.push("/login");
    }
  }, [phone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      setError("Please enter a display name.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Create avatar URL using Dicebear if empty
      const avatarUrl = avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(displayName)}`;
      
      await api.register(phone, displayName, avatarUrl);
      router.push(`/verify?phone=${encodeURIComponent(phone)}`);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.card} className="animate-fade">
      <div style={styles.logoContainer}>
        {/* Signal Clone Logo */}
        <svg width="72" height="72" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="128" cy="128" r="120" fill="#2C6BED" />
          <path d="M128 50C85 50 50 85 50 128C50 148 57.5 166.5 70 180.5L60 210L91.5 200.5C102.5 204 115 206 128 206C171 206 206 171 206 128C206 85 171 50 128 50Z" fill="white" />
          <circle cx="128" cy="128" r="28" fill="#2C6BED" />
        </svg>
      </div>

      <h1 style={styles.title}>Create your profile</h1>
      <p style={styles.subtitle}>Profiles are visible to your contacts in conversations.</p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Phone Number</label>
          <div style={{ ...styles.inputContainer, opacity: 0.6 }}>
            <input type="text" value={phone} disabled style={styles.input} />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Display Name</label>
          <div style={styles.inputContainer}>
            <input
              type="text"
              placeholder="e.g. John Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={styles.input}
              required
              disabled={loading}
              maxLength={25}
              autoFocus
            />
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Avatar URL (Optional)</label>
          <div style={styles.inputContainer}>
            <input
              type="url"
              placeholder="https://example.com/avatar.png"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              style={styles.input}
              disabled={loading}
            />
          </div>
          <span style={styles.helpText}>If left blank, an avatar will be generated.</span>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="submit"
          style={{
            ...styles.button,
            backgroundColor: loading ? "#7aa4f6" : "#2C6BED",
            cursor: loading ? "not-allowed" : "pointer"
          }}
          disabled={loading}
        >
          {loading ? "Registering..." : "Register & Continue"}
        </button>
      </form>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div style={styles.container}>
      <Suspense fallback={<div>Loading registration...</div>}>
        <RegisterContent />
      </Suspense>
    </div>
  );
}

const styles = {
  container: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--chat-bg)",
    color: "var(--text-primary)"
  },
  card: {
    width: "380px",
    padding: "32px",
    borderRadius: "16px",
    backgroundColor: "var(--sb-bg)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    border: "1px solid var(--border)",
    textAlign: "center" as const
  },
  logoContainer: {
    marginBottom: "20px",
    display: "flex",
    justifyContent: "center"
  },
  title: {
    fontSize: "24px",
    fontWeight: 600,
    marginBottom: "8px"
  },
  subtitle: {
    fontSize: "14px",
    color: "var(--text-secondary)",
    marginBottom: "24px"
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "16px",
    textAlign: "left" as const
  },
  formGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px"
  },
  label: {
    fontSize: "13px",
    fontWeight: 500,
    color: "var(--text-secondary)"
  },
  inputContainer: {
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "10px 14px",
    backgroundColor: "var(--chat-bg)"
  },
  input: {
    width: "100%",
    border: "none",
    background: "none",
    fontSize: "15px",
    outline: "none"
  },
  helpText: {
    fontSize: "11px",
    color: "var(--text-secondary)",
    marginTop: "2px"
  },
  error: {
    color: "#ff4d4d",
    fontSize: "13px",
    textAlign: "center" as const
  },
  button: {
    color: "#ffffff",
    padding: "12px",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: 600,
    marginTop: "8px",
    transition: "background-color 0.2s"
  }
};
