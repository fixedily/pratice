"use client";

import { useEffect } from "react";

export function LandingScrollbar() {
  useEffect(() => {
    document.documentElement.classList.add("landing-native-scrollbar");
    document.body.classList.add("landing-native-scrollbar");

    return () => {
      document.documentElement.classList.remove("landing-native-scrollbar");
      document.body.classList.remove("landing-native-scrollbar");
    };
  }, []);

  return null;
}
