#!/bin/bash

# Client Time Tracker - Linux Setup Helper
# This script helps install prerequisites and the application on Debian/Fedora systems.

set -e

# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Client Time Tracker - Linux Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to detect distro
detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_LIKE=$ID_LIKE
    else
        OS=$(uname -s)
    fi

    if [[ "$OS" == "debian" || "$OS" == "ubuntu" || "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]; then
        DISTRO="debian"
    elif [[ "$OS" == "fedora" || "$OS" == "rhel" || "$OS" == "centos" || "$OS_LIKE" == *"fedora"* || "$OS_LIKE" == *"rhel"* ]]; then
        DISTRO="fedora"
    else
        DISTRO="unknown"
    fi
}

detect_distro
echo -e "Detected distribution: ${GREEN}$DISTRO${NC}"

# Function to check and install Node.js
setup_node() {
    echo -e "
${BLUE}Checking Node.js...${NC}"
    if command -v node >/dev/null 2>&1; then
        NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        echo -e "Found Node.js v$(node -v)"
        if [ "$NODE_VER" -lt 20 ]; then
            echo -e "${YELLOW}Warning: Node.js version 20 or higher is required (found v$NODE_VER).${NC}"
            INSTALL_NODE=true
        else
            echo -e "${GREEN}Node.js version is sufficient.${NC}"
            INSTALL_NODE=false
        fi
    else
        echo -e "${YELLOW}Node.js is not installed.${NC}"
        INSTALL_NODE=true
    fi

    if [ "$INSTALL_NODE" = true ]; then
        read -p "Would you like to install Node.js 20? (y/n) " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo -e "Installing Node.js 20..."
            if [ "$DISTRO" == "debian" ]; then
                sudo apt-get update
                sudo apt-get install -y ca-certificates curl gnupg
                sudo mkdir -p /etc/apt/keyrings
                curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
                NODE_MAJOR=20
                echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
                sudo apt-get update
                sudo apt-get install nodejs -y
            elif [ "$DISTRO" == "fedora" ]; then
                sudo dnf install -y nodejs
            else
                echo -e "${RED}Unknown distro. Please install Node.js 20 manually.${NC}"
            fi
        fi
    fi
}

# Function to check and install GUI dependencies (for Client)
setup_gui_deps() {
    echo -e "
${BLUE}Checking GUI dependencies...${NC}"
    if [ "$DISTRO" == "debian" ]; then
        DEPS="libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 libasound2"
        echo -e "Ensuring common Electron dependencies are installed..."
        sudo apt-get update
        sudo apt-get install -y $DEPS
    elif [ "$DISTRO" == "fedora" ]; then
        DEPS="nss atk at-spi2-atk cups-libs libdrm gtk3 mesa-libgbm alsa-lib"
        echo -e "Ensuring common Electron dependencies are installed..."
        sudo dnf install -y $DEPS
    fi
    echo -e "${GREEN}GUI dependencies checked.${NC}"
}

# Main menu
echo ""
echo "What would you like to set up?"
echo "1) Client (Desktop Application)"
echo "2) Server (Standalone Service)"
echo "3) Both"
echo "4) Exit"
read -p "Select an option [1-4]: " OPTION

case $OPTION in
    1)
        setup_gui_deps
        ;;
    2)
        setup_node
        ;;
    3)
        setup_node
        setup_gui_deps
        ;;
    4)
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid option.${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}Prerequisites check complete!${NC}"
echo ""
echo "To install the application, run:"
if [ "$DISTRO" == "debian" ]; then
    echo -e "${YELLOW}  sudo apt install ./client-time-tracker*.deb${NC}"
elif [ "$DISTRO" == "fedora" ]; then
    echo -e "${YELLOW}  sudo dnf install ./client-time-tracker*.rpm${NC}"
fi
echo ""
echo -e "${BLUE}========================================${NC}"
