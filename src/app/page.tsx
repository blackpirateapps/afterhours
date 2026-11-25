import { redirect } from "next/navigation";
import { pageOwner } from "@/server/auth/page";

export default async function Index() {
  await pageOwner();
  redirect("/dashboard");
}
