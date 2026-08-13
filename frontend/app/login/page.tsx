"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../api";

export default function LoginPage() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await api.checkLogin(phone);
      if (res.registered) {
        // Redirect to verify page
        router.push(`/verify?phone=${encodeURIComponent(phone)}`);
      } else {
        // Redirect to registration page
        router.push(`/register?phone=${encodeURIComponent(phone)}`);
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card} className="animate-fade">
        <div style={styles.logoContainer}>
          {/* Signal Clone Logo */}
          <svg width="72" height="72" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="128" cy="128" r="120" fill="#2C6BED" />
            <path d="M128 50C85 50 50 85 50 128C50 148 57.5 166.5 70 180.5L60 210L91.5 200.5C102.5 204 115 206 128 206C171 206 206 171 206 128C206 85 171 50 128 50Z" fill="white" />
            <circle cx="128" cy="128" r="28" fill="#2C6BED" />
          </svg>
        </div>

        <h1 style={styles.title}>Welcome to Signal</h1>
        <p style={styles.subtitle}>Enter your phone number to get started.</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputContainer}>
            <input
              type="tel"
              placeholder="e.g. +12065550100"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={styles.input}
              required
              disabled={loading}
              autoFocus
            />
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
            {loading ? "Checking..." : "Continue"}
          </button>
        </form>
      </div>
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
    width: "360px",
    padding: "32px",
    borderRadius: "16px",
    backgroundColor: "var(--sb-bg)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    border: "1px solid var(--border)",
    textAlign: "center" as const
  },
  logoContainer: {
    marginBottom: "24px",
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
    gap: "16px"
  },
  inputContainer: {
    border: "1px solid var(--border)",
    borderRadius: "8px",
    padding: "12px 16px",
    backgroundColor: "var(--chat-bg)"
  },
  input: {
    width: "100%",
    border: "none",
    background: "none",
    fontSize: "16px",
    outline: "none",
    textAlign: "center" as const
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
    transition: "background-color 0.2s"
  }
};
