export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new AppError(400, m);
export const unauthorized = (m = "Authentication required") => new AppError(401, m);
export const forbidden = (m = "You don't have access to this") => new AppError(403, m);
export const notFound = (m = "Not found") => new AppError(404, m);
export const conflict = (m: string) => new AppError(409, m);
