#!/bin/sh
# Stands in for Ark in tests where Ark isn't available: takes Ark's
# command line and starts IRkernel (a plain Jupyter R kernel) instead.
# No Positron comms, but execute requests behave the same.
while [ $# -gt 0 ]; do
  case "$1" in
    --connection_file) CF="$2"; shift 2 ;;
    *) shift ;;
  esac
done
exec "$R_HOME/bin/R" --slave --no-save --no-restore -e "IRkernel::main('$CF')"
