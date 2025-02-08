import * as React from "react";
import { render } from "react-dom";
import { useReplit } from "@replit/extensions-react";

function Component() {
  const { replit } = useReplit();

  return <div>Replit Extension</div>;
}

render(<Component />, document.getElementById("root") as Element);
