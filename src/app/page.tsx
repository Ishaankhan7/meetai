"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";


/**
 * Renders the main authentication UI, allowing users to sign up, log in, view their session, and sign out.
 *
 * Displays sign-up and login forms when no user session exists. If a session is active, shows the logged-in user's name and a sign-out button. Handles user input and authentication actions using the `authClient` library.
 *
 * @returns The authentication UI as a React element.
 */
export default function Home() {

  const { data: session } = authClient.useSession()
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onsubmit = () => {
    authClient.signUp.email({
      email,
      name,
      password,
    }, {
      onError: () => {
        window.alert("Something went wrong");
      },
      onSuccess: () => {
        window.alert("Success");
      }
    });
  };

  const onLogin = () => {
    authClient.signIn.email({
      email,
      password,
    }, {
      onError: () => {
        window.alert("Something went wrong");
      },
      onSuccess: () => {
        window.alert("Success");
      }
    });
  };

  if (session) {
    return (
      <div className="flex flex-col p-4 gap-y-4">
        <p>Logged in as {session.user.name}</p>
        <Button onClick={() => authClient.signOut()}>
          sign out
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col p-4 gap-y-10">
      <div className="p-4 flex flex-col gap-y-4">
        <Input
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <Input
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button onClick={onsubmit}>
          Create user
        </Button>
      </div>
      <div className="p-4 flex flex-col gap-y-4">
        <Input
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Input
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button onClick={onLogin}>
          Login
        </Button>
      </div>
    </div>
  )
}
