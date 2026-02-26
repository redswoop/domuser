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
