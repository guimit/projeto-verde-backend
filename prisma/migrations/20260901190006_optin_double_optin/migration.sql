-- CreateEnum
CREATE TYPE "OptInState" AS ENUM ('awaiting_consent', 'awaiting_name', 'confirmed', 'opted_out');

-- CreateEnum
CREATE TYPE "ConsentEventType" AS ENUM ('granted', 'revoked');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "consentSource" TEXT;

-- CreateTable
CREATE TABLE "OptInSession" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "channelId" TEXT,
    "state" "OptInState" NOT NULL DEFAULT 'awaiting_consent',
    "profileName" TEXT,
    "chosenName" TEXT,
    "lastPromptAt" TIMESTAMP(3),
    "lastInboundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,

    CONSTRAINT "OptInSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "type" "ConsentEventType" NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "promptText" TEXT,
    "promptVersion" TEXT,
    "replyText" TEXT,
    "inboundMessageId" TEXT,
    "providerTimestamp" TIMESTAMP(3),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OptInSession_companyId_phone_key" ON "OptInSession"("companyId", "phone");

-- AddForeignKey
ALTER TABLE "OptInSession" ADD CONSTRAINT "OptInSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
