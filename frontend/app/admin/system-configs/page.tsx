import { redirect } from "next/navigation";

export default function AdminSystemConfigsPage() {
  redirect("/settings?panel=basic");
}
