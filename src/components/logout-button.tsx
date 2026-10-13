"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

/** 登出：清 session cookie 後回 /login（TASK-002） */
export function LogoutButton() {
  return (
    <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })}>
      登出
    </Button>
  );
}
