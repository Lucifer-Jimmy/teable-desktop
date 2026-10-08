-- CreateTable
CREATE TABLE "app" (
    "id" TEXT NOT NULL,
    "baseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "deletedTime" TIMESTAMP(3),
    "createdTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "lastModifiedTime" TIMESTAMP(3) NOT NULL,
    "lastModifiedBy" TEXT,
    CONSTRAINT "app_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_version" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "htmlContent" TEXT,
    "description" TEXT,
    "createdTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "app_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_baseId_deletedTime_idx" ON "app"("baseId", "deletedTime");

-- CreateIndex
CREATE UNIQUE INDEX "app_version_appId_version_key" ON "app_version"("appId", "version");

-- AddForeignKey
ALTER TABLE "app_version" ADD CONSTRAINT "app_version_appId_fkey" FOREIGN KEY ("appId") REFERENCES "app"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
