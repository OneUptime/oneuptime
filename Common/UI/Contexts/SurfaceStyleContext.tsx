import React, {
  Context,
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
} from "react";

export enum SurfaceStyle {
  Default = "default",
  Quiet = "quiet",
}

const SurfaceStyleContext: Context<SurfaceStyle> =
  React.createContext<SurfaceStyle>(SurfaceStyle.Default);

export interface SurfaceStyleProviderProps {
  children: ReactNode;
  style: SurfaceStyle;
}

export const SurfaceStyleProvider: FunctionComponent<
  SurfaceStyleProviderProps
> = (props: SurfaceStyleProviderProps): ReactElement => {
  return (
    <SurfaceStyleContext.Provider value={props.style}>
      {props.children}
    </SurfaceStyleContext.Provider>
  );
};

export const useSurfaceStyle: () => SurfaceStyle = (): SurfaceStyle => {
  return useContext(SurfaceStyleContext);
};

export default SurfaceStyleContext;
