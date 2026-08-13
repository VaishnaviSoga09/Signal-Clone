"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { User, api } from "./api";
import { useRouter, usePathname } from "next/navigation";

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem("signal_token");
      const storedUser = localStorage.getItem("signal_user");
      
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        
        try {
          // Verify with server
          const me = await api.getMe();
          setUser(me);
          localStorage.setItem("signal_user", JSON.stringify(me));
        } catch (err) {
          console.error("Auth token verification failed", err);
          // Token expired or server offline - we don't immediately clear if offline, 
          // but if it's unauthorized, clear
          if (err instanceof Error && err.message.includes("401")) {
            logout();
          }
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  useEffect(() => {
    if (!loading) {
      const isAuthPage = pathname === "/login" || pathname === "/register" || pathname === "/verify";
      if (!user && !isAuthPage) {
        router.push("/login");
      } else if (user && isAuthPage) {
        router.push("/");
      }
    }
  }, [user, pathname, loading]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem("signal_token", newToken);
    localStorage.setItem("signal_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    router.push("/");
  };

  const logout = () => {
    localStorage.removeItem("signal_token");
    localStorage.removeItem("signal_user");
    setToken(null);
    setUser(null);
    router.push("/login");
  };

  const refreshUser = async () => {
    try {
      const me = await api.getMe();
      setUser(me);
      localStorage.setItem("signal_user", JSON.stringify(me));
    } catch (err) {
      console.error("Failed to refresh user", err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
