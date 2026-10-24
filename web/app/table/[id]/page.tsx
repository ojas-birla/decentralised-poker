"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";

const TableScreen = dynamic(() => import("@/components/table/TableScreen"), {
  ssr: false,
  loading: () => <p>Loading table…</p>,
});

export default function TablePage() {
  const params = useParams<{ id: string }>();

  // SPEC.md: tableId is a decimal string (an on-chain uint256). Never use Number().
  if (!/^\d+$/.test(params.id)) {
    return <p>Invalid table id.</p>;
  }

  return <TableScreen tableId={params.id} />;
}