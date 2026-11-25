import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwner } from ".";
import { AppError } from "../errors";

export const pageOwner = cache(async () => {
  try {
    return await requireOwner(await headers());
  } catch (error) {
    if (error instanceof AppError) {
      if (error.status === 401) redirect("/sign-in");
      if (error.status === 403) redirect("/sign-in?error=invite_required");
      if (error.code === "configuration")
        redirect("/sign-in?error=configuration");
    }
    throw error;
  }
});
