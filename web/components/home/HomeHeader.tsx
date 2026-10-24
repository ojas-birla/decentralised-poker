"use client";

import CreateHeader from "@/components/create/CreateHeader";

// Same header as the other pages (network pill + wallet menu), with the logo
// pointing at the home page instead of the lobby.
export default function HomeHeader() {
  return <CreateHeader logoHref="/" />;
}
