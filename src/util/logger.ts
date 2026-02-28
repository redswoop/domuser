import winston from "winston";

const { combine, timestamp, printf, colorize } = winston.format;

const fmt = printf(({ level, message, timestamp, component }) => {
  const comp = component ? `[${component}]` : "";
  return `${timestamp} ${level} ${comp} ${message}`;
});

let logger: winston.Logger;

export function initLogger(level: string): winston.Logger {
  logger = winston.createLogger({
    level,
    format: combine(timestamp({ format: "HH:mm:ss.SSS" }), colorize(), fmt),
    transports: [new winston.transports.Console()],
  });
  return logger;
}

export function getLogger(component?: string): winston.Logger {
  if (!logger) {
    logger = initLogger("info");
  }
  return logger.child({ component });
}

/**
 * Replace the console transport with a file transport.
 * Used in orchestrate mode so winston doesn't conflict with the ink TUI.
 */
export function replaceConsoleTransport(filePath: string): void {
  if (!logger) {
    logger = initLogger("info");
  }
  logger.clear();
  logger.add(
    new winston.transports.File({
      filename: filePath,
      format: combine(timestamp({ format: "HH:mm:ss.SSS" }), fmt),
    }),
  );
}
