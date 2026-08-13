"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Apply theme from localStorage on initial load
    const storedTheme = localStorage.getItem("signal_theme") || "light";
    if (storedTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  if (loading || !mounted) {
    return (
      <div style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#121212",
        color: "#ffffff"
      }}>
        <div style={{ textAlign: "center" }}>
          {/* Signal SVG Logo */}
          <svg width="64" height="64" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: "20px" }}>
            <circle cx="128" cy="128" r="120" fill="#2C6BED" />
            <path d="M128 50C85 50 50 85 50 128C50 148 57.5 166.5 70 180.5L60 210L91.5 200.5C102.5 204 115 206 128 206C171 206 206 171 206 128C206 85 171 50 128 50Z" fill="white" />
            <circle cx="128" cy="128" r="28" fill="#2C6BED" />
          </svg>
          <div style={{ fontSize: "16px", fontWeight: 500, fontFamily: "sans-serif" }}>Signal Messenger</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
