"use client";

import { api } from "@socal/backend/convex/_generated/api";
import type { Id } from "@socal/backend/convex/_generated/dataModel";
import { Button } from "@socal/ui/components/button";
import { Input } from "@socal/ui/components/input";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";

import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Wordmark } from "@/components/wordmark";
import { useAuth } from "@/lib/auth";

const PROFILE_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const PROFILE_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const CROPPED_PHOTO_SIZE = 512;
const PROFILE_AUTOSAVE_MS = 600;
const PROFILE_SAVE_TIMEOUT_MS = 8000;

export default function ProfilePage() {
  return (
    <RequireAuth>
      <main className="min-h-screen">
        <header className="flex items-center justify-between px-6 py-5">
          <Link href="/" aria-label="Home">
            <Wordmark size="sm" />
          </Link>
          <UserMenu />
        </header>
        <ProfileContent />
      </main>
    </RequireAuth>
  );
}

function ProfileContent() {
  const { userId } = useAuth();
  const fileInputId = useId();
  const cropImageRef = useRef<HTMLImageElement>(null);
  const user = useQuery(api.users.getById, userId ? { userId } : "skip");
  const accounts = useQuery(
    api.googleAccounts.listByUser,
    userId ? { userId } : "skip",
  );
  const updateProfile = useMutation(api.users.updateProfile);
  const setPhoto = useMutation(api.users.setPhoto);
  const generateUploadUrl = useMutation(api.users.generatePhotoUploadUrl);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [profileSaveError, setProfileSaveError] = useState<string | null>(null);
  const [hasHydratedForm, setHasHydratedForm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [cropSource, setCropSource] = useState<{
    url: string;
    fileName: string;
  } | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName);
    setLastName(user.lastName);
    setTimeZone(
      user.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    setHasHydratedForm(true);
  }, [user?._id]);

  useEffect(() => {
    if (!userId || !user || !hasHydratedForm) return;
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last || !timeZone) return;
    if (
      first === user.firstName &&
      last === user.lastName &&
      timeZone === (user.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
    ) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      setIsSaving(true);
      setProfileSaveError(null);
      try {
        await withTimeout(
          updateProfile({
            userId,
            firstName: first,
            lastName: last,
            timeZone,
          }),
          PROFILE_SAVE_TIMEOUT_MS,
          "Could not autosave. Check that Convex is running.",
        );
      } catch (error) {
        setProfileSaveError(errorMessage(error));
      } finally {
        setIsSaving(false);
      }
    }, PROFILE_AUTOSAVE_MS);

    return () => window.clearTimeout(timeout);
  }, [
    firstName,
    lastName,
    timeZone,
    userId,
    user,
    hasHydratedForm,
    updateProfile,
  ]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [user?.photoUrl, accounts]);

  useEffect(() => {
    return () => {
      if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    };
  }, [localPreviewUrl]);

  useEffect(() => {
    return () => {
      if (cropSource) URL.revokeObjectURL(cropSource.url);
    };
  }, [cropSource]);

  if (!userId || !user) return null;

  const timeZones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [timeZone];

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setUploadError(null);
    setUploadStatus(null);
    setAvatarLoadFailed(false);
    if (!PROFILE_PHOTO_TYPES.has(file.type)) {
      setUploadError("Choose a JPG, PNG, WebP, or GIF.");
      e.target.value = "";
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setCropSource((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url: previewUrl, fileName: file.name };
    });
    setCropZoom(1);
    setCropOffset({ x: 0, y: 0 });
    e.target.value = "";
  }

  async function uploadPhoto(file: Blob) {
    if (!userId) return;
    setIsUploading(true);
    try {
      let url: string;
      try {
        setUploadStatus("Preparing upload...");
        url = await generateUploadUrl({});
      } catch (err) {
        throw new Error(
          `Could not create upload URL: ${errorMessage(err)}`,
        );
      }

      let result: Response;
      try {
        setUploadStatus("Uploading image...");
        result = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "image/jpeg" },
          body: file,
        });
      } catch (err) {
        throw new Error(`Could not upload image: ${errorMessage(err)}`);
      }

      if (!result.ok) {
        const body = await result.text().catch(() => "");
        throw new Error(
          `Could not upload image (${result.status})${
            body ? `: ${body}` : ""
          }`,
        );
      }
      const { storageId } = (await result.json()) as {
        storageId: Id<"_storage">;
      };
      try {
        setUploadStatus("Saving photo...");
        await setPhoto({ userId, storageId });
        setUploadStatus(null);
      } catch (err) {
        throw new Error(`Could not save photo: ${errorMessage(err)}`);
      }
    } catch (err) {
      setLocalPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setUploadStatus(null);
      setUploadError(errorMessage(err));
    } finally {
      setIsUploading(false);
    }
  }

  async function handleCropSave() {
    if (!cropSource || !cropImageRef.current) return;
    setUploadError(null);
    setUploadStatus(null);
    const blob = await cropImageToSquare(
      cropImageRef.current,
      cropZoom,
      cropOffset,
    );
    const previewUrl = URL.createObjectURL(blob);
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return previewUrl;
    });
    setCropSource((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    await uploadPhoto(blob);
  }

  function handleCropCancel() {
    setCropSource((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  function handleCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: cropOffset.x,
      offsetY: cropOffset.y,
    });
  }

  function handleCropPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    setCropOffset({
      x: dragStart.offsetX + event.clientX - dragStart.x,
      y: dragStart.offsetY + event.clientY - dragStart.y,
    });
  }

  function handleCropPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (dragStart?.pointerId === event.pointerId) {
      setDragStart(null);
    }
  }

  async function handleRemovePhoto() {
    if (!userId) return;
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setUploadError(null);
    setUploadStatus(null);
    setAvatarLoadFailed(false);
    await setPhoto({ userId, storageId: null });
  }

  const initials =
    (user.firstName[0] ?? "").toUpperCase() +
    (user.lastName[0] ?? "").toUpperCase();
  const googlePhotoUrl = accounts?.find((account) => account.pictureUrl)
    ?.pictureUrl;
  const avatarUrl =
    localPreviewUrl ??
    user.photoUrl ??
    (user.useDefaultAvatar !== false ? googlePhotoUrl : undefined);
  const showAvatarImage = avatarUrl && !avatarLoadFailed;
  const hasUploadedPhoto = user.photoUrl !== null;
  const showStickFigure =
    user.useDefaultAvatar === false && !localPreviewUrl && !user.photoUrl;

  return (
    <section className="mx-auto flex w-full max-w-md flex-col gap-8 px-6 py-6">
      <h1 className="text-lg font-medium">Profile</h1>

      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted text-xl font-medium text-muted-foreground">
          {showAvatarImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => {
                setAvatarLoadFailed(true);
                if (hasUploadedPhoto) {
                  setUploadError(
                    "Photo saved, but this file cannot be displayed. Try a JPG, PNG, WebP, or GIF.",
                  );
                  setUploadStatus(null);
                }
              }}
              className="h-full w-full object-cover"
            />
          ) : showStickFigure ? (
            <StickFigureAvatar className="h-10 w-10" />
          ) : (
            <span>{initials || "?"}</span>
          )}
        </div>
        <div className="flex flex-col items-start gap-1">
          <input
            id={fileInputId}
            type="file"
            accept={PROFILE_PHOTO_ACCEPT}
            className="sr-only"
            onChange={handleFileChange}
            disabled={isUploading}
          />
          <label
            htmlFor={fileInputId}
            aria-disabled={isUploading}
            className="inline-flex h-8 cursor-pointer items-center justify-center rounded-xl bg-secondary px-3 text-sm font-medium text-secondary-foreground shadow-xs transition-all hover:bg-secondary/80 aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            {isUploading ? "Uploading..." : avatarUrl || showStickFigure ? "Change photo" : "Upload photo"}
          </label>
          {(hasUploadedPhoto || user.useDefaultAvatar !== false) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-xl text-muted-foreground"
              disabled={isUploading}
              onClick={handleRemovePhoto}
            >
              Remove
            </Button>
          )}
          {uploadError && (
            <span className="text-xs text-destructive">{uploadError}</span>
          )}
          {!uploadError && uploadStatus && (
            <span className="text-xs text-muted-foreground">
              {uploadStatus}
            </span>
          )}
        </div>
      </div>

      {cropSource && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Crop profile photo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        >
          <div className="w-full max-w-sm rounded-md border bg-popover p-4 text-popover-foreground shadow-lg">
            <h2 className="text-base font-medium">Crop photo</h2>
            <div
              className="mt-4 relative mx-auto size-64 cursor-grab touch-none overflow-hidden rounded-md border bg-muted active:cursor-grabbing"
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerUp}
              onPointerCancel={handleCropPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={cropImageRef}
                src={cropSource.url}
                alt=""
                className="absolute inset-0 h-full w-full select-none object-cover"
                draggable={false}
                style={{
                  transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropZoom})`,
                  transformOrigin: "center",
                }}
              />
            </div>
            <label className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground">
              Zoom
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={cropZoom}
                onChange={(event) => setCropZoom(Number(event.target.value))}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={isUploading}
                onClick={handleCropCancel}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isUploading}
                onClick={handleCropSave}
              >
                {isUploading ? "Saving..." : "Save photo"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          First name
          <Input
            type="text"
            autoComplete="given-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="h-12 rounded-2xl px-5 text-base md:text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Last name
          <Input
            type="text"
            autoComplete="family-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="h-12 rounded-2xl px-5 text-base md:text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Display timezone
          <select
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            className="h-12 rounded-2xl border bg-background px-5 text-base"
          >
            {!timeZones.includes(timeZone) && (
              <option value={timeZone}>{timeZone}</option>
            )}
            {timeZones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        <div className="min-h-4 px-1 text-xs text-muted-foreground">
          {profileSaveError ? (
            <span className="text-destructive">{profileSaveError}</span>
          ) : isSaving ? (
            "Saving..."
          ) : null}
        </div>
      </div>
    </section>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Upload failed";
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function cropImageToSquare(
  image: HTMLImageElement,
  zoom: number,
  offset: { x: number; y: number },
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = CROPPED_PHOTO_SIZE;
  canvas.height = CROPPED_PHOTO_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare photo crop.");

  const frameSize = 256;
  const scale =
    Math.max(frameSize / image.naturalWidth, frameSize / image.naturalHeight) *
    zoom;
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  const cropScale = CROPPED_PHOTO_SIZE / frameSize;

  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    (frameSize / 2 - drawnWidth / 2 + offset.x) * cropScale,
    (frameSize / 2 - drawnHeight / 2 + offset.y) * cropScale,
    drawnWidth * cropScale,
    drawnHeight * cropScale,
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not save cropped photo."));
      },
      "image/jpeg",
      0.92,
    );
  });
}

function StickFigureAvatar({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="6.5" r="3" />
      <path d="M12 9.5v6" />
      <path d="M7.5 12.5h9" />
      <path d="M12 15.5l-4 5" />
      <path d="M12 15.5l4 5" />
    </svg>
  );
}
