"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../api";
import { useAuth } from "../AuthContext";

function VerifyContent() {
  const searchParams = useSearchParams();
  const phone = searchParams.get("phone") || "";
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { login } = useAuth();

  useEffect(() => {
    if (!phone) {
      router.push("/login");
    }
  }, [phone]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.length !== 6) {
      setError("Please enter a 6-digit code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await api.verifyOtp(phone, otp);
      login(res.access_token, res.user);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Invalid code. Use 123456.");
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

      <h1 style={styles.title}>Verify your number</h1>
      <p style={styles.subtitle}>We sent a code to <b>{phone}</b>.<br />For testing, enter <b>123456</b></p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.inputContainer}>
          <input
            type="text"
            maxLength={6}
            placeholder="123456"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
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
          {loading ? "Verifying..." : "Verify & Log In"}
        </button>

        <button
          type="button"
          onClick={() => router.push("/login")}
          style={styles.backButton}
          disabled={loading}
        >
          Back to Phone Entry
        </button>
      </form>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div style={styles.container}>
      <Suspense fallback={<div>Loading verification...</div>}>
        <VerifyContent />
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
    marginBottom: "24px",
    lineHeight: "1.5"
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
    fontSize: "24px",
    fontWeight: 700,
    letterSpacing: "8px",
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
  },
  backButton: {
    color: "#2C6BED",
    fontSize: "14px",
    fontWeight: 500,
    marginTop: "8px"
  }
};
