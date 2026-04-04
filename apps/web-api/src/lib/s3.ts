/**
 * S3 client with lazy singleton and helper exports.
 */

import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
} from "@aws-sdk/client-s3";

export {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand
};

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

export function getS3ClientAndBucket() {
  const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? "http://localhost:9000";
  const signingEndpoint = publicEndpoint;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  if (!signingEndpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 configuration: S3_ENDPOINT/S3_PUBLIC_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET");
  }

  const client = new S3Client({
    endpoint: signingEndpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });

  return { client, bucket };
}

export function getInternalS3ClientAndBucket() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;
  const bucket = process.env.S3_BUCKET;
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true";

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error("Missing S3 configuration: S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET");
  }

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED"
  });

  return { client, bucket };
}
